using System.Data;
using System.Collections;
using System.Globalization;
using System.Text;
using System.Text.Json;
using CsvHelper;
using CsvHelper.Configuration;
using DataLens.Domain.Entities;
using DataLens.Infrastructure.Data;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace DataLens.Infrastructure.Imports;

public sealed class DatasetCsvImporter
{
    private const int SampleSize = 5_000;
    private const int MaximumColumns = 128;
    private const decimal MinimumTypedValueRatio = 0.95m;
    private readonly AppDbContext _dbContext;
    private readonly string _connectionString;

    public DatasetCsvImporter(AppDbContext dbContext, IConfiguration configuration)
    {
        _dbContext = dbContext;
        _connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("The DefaultConnection setting is required.");
    }

    public async Task<CsvImportResult> ImportAsync(
        Stream fileStream,
        string fileName,
        string datasetName,
        string userId,
        CancellationToken cancellationToken)
    {
        var dataset = new Dataset
        {
            Name = datasetName,
            FileName = Path.GetFileName(fileName),
            CreatedById = userId
        };

        if (!fileStream.CanSeek)
        {
            throw new InvalidDataException("The CSV stream must support seeking.");
        }

        return await ImportIntoAsync(fileStream, dataset, fileStream.Length, cancellationToken);
    }

    public async Task<CsvImportResult> ImportIntoAsync(
        Stream fileStream,
        Dataset dataset,
        long fileSizeBytes,
        CancellationToken cancellationToken,
        Action<int, long>? onProgress = null)
    {
        if (!fileStream.CanSeek)
        {
            throw new InvalidDataException("The CSV stream must support seeking.");
        }

        var (headers, types) = await InferSchemaAsync(fileStream, cancellationToken);
        dataset.Columns.Clear();
        dataset.Columns = headers.Select((header, position) => new DatasetColumn
        {
            Name = header,
            TypeName = types[position],
            IsNullable = true,
            Position = position
        }).ToList();
        if (_dbContext.Entry(dataset).State == EntityState.Detached)
        {
            _dbContext.Datasets.Add(dataset);
        }

        _dbContext.DatasetColumns.AddRange(dataset.Columns);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var tableName = GetTableName(dataset.Id);
        var errorSpoolPath = Path.Combine(Path.GetTempPath(), $"datalens-import-errors-{Guid.NewGuid():N}.jsonl");
        try
        {
            var import = await CreateAndBulkLoadAsync(
                fileStream,
                tableName,
                headers,
                types,
                dataset.Id,
                errorSpoolPath,
                fileSizeBytes,
                cancellationToken,
                onProgress);
            dataset.RowCount = import.RowsImported;
            dataset.SkippedRows = import.RowsSkipped;
            await _dbContext.SaveChangesAsync(cancellationToken);
            onProgress?.Invoke(100, import.RowsImported);
            return new CsvImportResult(dataset, import.RowsSkipped, import.ErrorCount);
        }
        catch
        {
            await DropTableIfExistsAsync(tableName, CancellationToken.None);
            dataset.Columns.Clear();
            dataset.RowCount = 0;
            dataset.SkippedRows = 0;
            await _dbContext.SaveChangesAsync(CancellationToken.None);
            throw;
        }
        finally
        {
            if (File.Exists(errorSpoolPath))
            {
                File.Delete(errorSpoolPath);
            }
        }
    }

    public async Task DropTableAsync(Guid datasetId, CancellationToken cancellationToken)
    {
        await DropTableIfExistsAsync(GetTableName(datasetId), cancellationToken);
    }

    public static string GetTableName(Guid datasetId) => $"[data].[ds_{datasetId:N}]";

    private async Task<(string[] Headers, string[] Types)> InferSchemaAsync(
        Stream source,
        CancellationToken cancellationToken)
    {
        source.Position = 0;
        using var textReader = new StreamReader(source, Encoding.UTF8, true, 1024, leaveOpen: true);
        using var csv = new CsvReader(textReader, CreateCsvConfiguration());

        if (!await csv.ReadAsync())
        {
            throw new InvalidDataException("The CSV file is empty.");
        }

        csv.ReadHeader();
        var rawHeaders = csv.HeaderRecord;
        if (rawHeaders is null || rawHeaders.Length == 0 || rawHeaders.Length > MaximumColumns)
        {
            throw new InvalidDataException($"CSV files must contain between 1 and {MaximumColumns} columns.");
        }

        var headers = NormalizeHeaders(rawHeaders);
        var samples = headers.Select(_ => new List<string>(SampleSize)).ToArray();
        var sampledRows = 0;

        while (sampledRows < SampleSize && await csv.ReadAsync())
        {
            for (var index = 0; index < headers.Length; index++)
            {
                var value = csv.TryGetField(index, out string? field) ? field?.Trim() ?? string.Empty : string.Empty;
                if (value.Length > 0)
                {
                    samples[index].Add(value);
                }
            }

            sampledRows++;
        }

        var types = samples.Select(InferType).ToArray();
        return (headers, types);
    }

    private async Task<(long RowsImported, long RowsSkipped, long ErrorCount)> CreateAndBulkLoadAsync(
        Stream source,
        string tableName,
        string[] headers,
        string[] types,
        Guid datasetId,
        string errorSpoolPath,
        long fileSizeBytes,
        CancellationToken cancellationToken,
        Action<int, long>? onProgress)
    {
        source.Position = 0;
        using var textReader = new StreamReader(source, Encoding.UTF8, true, 1024, leaveOpen: true);
        using var csv = new CsvReader(textReader, CreateCsvConfiguration());
        if (!await csv.ReadAsync())
        {
            throw new InvalidDataException("The CSV file is empty.");
        }

        csv.ReadHeader();
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            var columns = string.Join(", ", types.Select((type, index) =>
                $"[c{index}] {GetSqlType(type)} NULL"));
            await using (var createCommand = connection.CreateCommand())
            {
                createCommand.Transaction = transaction;
                createCommand.CommandText = $"""
                    IF SCHEMA_ID(N'data') IS NULL EXEC(N'CREATE SCHEMA [data]');
                    CREATE TABLE {tableName} ({columns});
                    """;
                await createCommand.ExecuteNonQueryAsync(cancellationToken);
            }

            using var reader = new CsvBulkDataReader(
                csv,
                headers,
                types,
                datasetId,
                errorSpoolPath,
                source,
                fileSizeBytes,
                onProgress);
            using var bulkCopy = new SqlBulkCopy(connection, SqlBulkCopyOptions.TableLock, transaction)
            {
                DestinationTableName = tableName,
                BatchSize = 10_000,
                EnableStreaming = true,
                BulkCopyTimeout = 0
            };

            for (var index = 0; index < headers.Length; index++)
            {
                bulkCopy.ColumnMappings.Add(index, $"c{index}");
            }

            await bulkCopy.WriteToServerAsync(reader, cancellationToken);
            reader.FlushErrors();
            reader.CloseErrorWriter();
            var errorCount = await BulkInsertErrorsAsync(
                connection,
                transaction,
                errorSpoolPath,
                cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return (reader.RowsRead, reader.RowsSkipped, errorCount);
        }
        catch
        {
            await transaction.RollbackAsync(CancellationToken.None);
            throw;
        }
    }

    private async Task DropTableIfExistsAsync(string tableName, CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = $"""
            IF OBJECT_ID(N'{tableName.Replace("[", string.Empty).Replace("]", string.Empty)}', N'U') IS NOT NULL
                DROP TABLE {tableName};
            """;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<long> BulkInsertErrorsAsync(
        SqlConnection connection,
        SqlTransaction transaction,
        string errorSpoolPath,
        CancellationToken cancellationToken)
    {
        var batch = new DataTable();
        batch.Columns.Add("Id", typeof(Guid));
        batch.Columns.Add("DatasetId", typeof(Guid));
        batch.Columns.Add("RowNumber", typeof(long));
        batch.Columns.Add("ColumnName", typeof(string)).AllowDBNull = true;
        batch.Columns.Add("RawValue", typeof(string)).AllowDBNull = true;
        batch.Columns.Add("Reason", typeof(string));

        using var bulkCopy = new SqlBulkCopy(connection, SqlBulkCopyOptions.TableLock, transaction)
        {
            DestinationTableName = "[dbo].[ImportErrors]",
            BatchSize = 1_000,
            BulkCopyTimeout = 0
        };
        foreach (DataColumn column in batch.Columns)
        {
            bulkCopy.ColumnMappings.Add(column.ColumnName, column.ColumnName);
        }

        long count = 0;
        using var spool = new StreamReader(errorSpoolPath, Encoding.UTF8);
        while (await spool.ReadLineAsync(cancellationToken) is { } line)
        {
            var error = JsonSerializer.Deserialize<CsvImportErrorRecord>(line)
                ?? throw new InvalidDataException("An import error could not be read from its temporary spool.");
            var row = batch.NewRow();
            row["Id"] = error.Id;
            row["DatasetId"] = error.DatasetId;
            row["RowNumber"] = error.RowNumber;
            row["ColumnName"] = (object?)error.ColumnName ?? DBNull.Value;
            row["RawValue"] = (object?)error.RawValue ?? DBNull.Value;
            row["Reason"] = error.Reason;
            batch.Rows.Add(row);
            count++;

            if (batch.Rows.Count == 1_000)
            {
                await bulkCopy.WriteToServerAsync(batch, cancellationToken);
                batch.Clear();
            }
        }

        if (batch.Rows.Count > 0)
        {
            await bulkCopy.WriteToServerAsync(batch, cancellationToken);
        }

        return count;
    }

    private static CsvConfiguration CreateCsvConfiguration() => new(CultureInfo.InvariantCulture)
    {
        DetectDelimiter = true,
        DetectDelimiterValues = [",", ";", "\t", "|"],
        BadDataFound = context => throw new InvalidDataException(
            $"Malformed CSV data near row {context.Context.Parser?.Row ?? 0}."),
        MissingFieldFound = null,
        HeaderValidated = null,
        TrimOptions = TrimOptions.Trim
    };

    private static string[] NormalizeHeaders(string[] rawHeaders)
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var headers = new string[rawHeaders.Length];
        for (var index = 0; index < rawHeaders.Length; index++)
        {
            var baseName = string.IsNullOrWhiteSpace(rawHeaders[index])
                ? $"Column {index + 1}"
                : rawHeaders[index].Trim();
            if (baseName.Length > 200)
            {
                baseName = baseName[..200];
            }

            var name = baseName;
            var suffix = 2;
            while (!names.Add(name))
            {
                var suffixText = $" ({suffix++})";
                name = baseName[..Math.Min(baseName.Length, 200 - suffixText.Length)] + suffixText;
            }

            headers[index] = name;
        }

        return headers;
    }

    private static string InferType(IReadOnlyCollection<string> values)
    {
        if (values.Count == 0)
        {
            return "text";
        }

        if (MeetsTypedValueThreshold(values, CsvBulkDataReader.IsBoolean))
        {
            return "boolean";
        }

        if (MeetsTypedValueThreshold(values, value =>
                DateOnly.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out _)))
        {
            return "date";
        }

        if (MeetsTypedValueThreshold(values, value =>
                DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out _)))
        {
            return "datetime";
        }

        if (MeetsTypedValueThreshold(values, value => long.TryParse(
                value,
                NumberStyles.Integer,
                CultureInfo.InvariantCulture,
                out _)))
        {
            return "integer";
        }

        return MeetsTypedValueThreshold(values, value => decimal.TryParse(
            value,
            NumberStyles.Number | NumberStyles.AllowExponent,
            CultureInfo.InvariantCulture,
            out _))
            ? "decimal"
            : "text";
    }

    private static bool MeetsTypedValueThreshold(IReadOnlyCollection<string> values, Func<string, bool> parser) =>
        values.Count(value => parser(value)) / (decimal)values.Count >= MinimumTypedValueRatio;

    private static string GetSqlType(string type) => type switch
    {
        "integer" => "bigint",
        "decimal" => "decimal(38, 10)",
        "date" => "date",
        "datetime" => "datetime2",
        "boolean" => "bit",
        _ => "nvarchar(max)"
    };

    private sealed class CsvBulkDataReader : IDataReader
    {
        private readonly CsvReader _csv;
        private readonly string[] _headers;
        private readonly string[] _types;
        private readonly Guid _datasetId;
        private readonly StreamWriter _errorWriter;
        private readonly Stream _source;
        private readonly long _fileSizeBytes;
        private readonly Action<int, long>? _onProgress;
        private object[] _currentValues = [];
        private bool _closed;
        private DateTime _lastProgressAt = DateTime.MinValue;

        public CsvBulkDataReader(
            CsvReader csv,
            string[] headers,
            string[] types,
            Guid datasetId,
            string errorSpoolPath,
            Stream source,
            long fileSizeBytes,
            Action<int, long>? onProgress)
        {
            _csv = csv;
            _headers = headers;
            _types = types;
            _datasetId = datasetId;
            _errorWriter = new StreamWriter(errorSpoolPath, append: false, Encoding.UTF8);
            _source = source;
            _fileSizeBytes = fileSizeBytes;
            _onProgress = onProgress;
        }

        public object this[int i] => GetValue(i);
        public object this[string name] => GetValue(GetOrdinal(name));
        public int FieldCount => _headers.Length;
        public bool IsClosed => _closed;
        public int RecordsAffected => -1;
        public int Depth => 0;
        public bool Read()
        {
            while (_csv.Read())
            {
                var rowNumber = Math.Max(_csv.Parser.Row, 1);
                if (_csv.Parser.Count != FieldCount)
                {
                    RowsSkipped++;
                    var rawRow = string.Join(",", Enumerable.Range(0, _csv.Parser.Count)
                        .Select(index => _csv.TryGetField(index, out string? field) ? field ?? string.Empty : string.Empty));
                    WriteError(null, rawRow, $"Expected {FieldCount} fields but found {_csv.Parser.Count}.", rowNumber);
                    ReportProgress();
                    continue;
                }

                var values = new object[FieldCount];
                var rowErrors = new List<(string Column, string RawValue, string Reason)>();
                for (var index = 0; index < FieldCount; index++)
                {
                    if (!_csv.TryGetField(index, out string? raw) || string.IsNullOrWhiteSpace(raw))
                    {
                        values[index] = DBNull.Value;
                        continue;
                    }

                    if (!TryConvert(_types[index], raw.Trim(), out var value))
                    {
                        rowErrors.Add((_headers[index], raw, GetConversionError(_types[index])));
                        continue;
                    }

                    values[index] = value;
                }

                if (rowErrors.Count > 0)
                {
                    RowsSkipped++;
                    foreach (var error in rowErrors)
                    {
                        WriteError(error.Column, error.RawValue, error.Reason, rowNumber);
                    }

                    ReportProgress();
                    continue;
                }

                _currentValues = values;
                RowsRead++;
                ReportProgress();
                return true;
            }

            return false;
        }
        public long RowsRead { get; private set; }
        public long RowsSkipped { get; private set; }
        public void FlushErrors() => _errorWriter.Flush();
        public void CloseErrorWriter() => _errorWriter.Close();
        public bool NextResult() => false;
        public void Close() => _closed = true;
        public void Dispose()
        {
            _errorWriter.Dispose();
            Close();
        }
        public DataTable? GetSchemaTable() => null;
        public string GetName(int i) => _headers[i];
        public int GetOrdinal(string name) => Array.FindIndex(_headers, header => string.Equals(header, name, StringComparison.OrdinalIgnoreCase));
        public string GetDataTypeName(int i) => GetFieldType(i).Name;
        public Type GetFieldType(int i) => _types[i] switch
        {
            "integer" => typeof(long),
            "decimal" => typeof(decimal),
            "date" => typeof(DateTime),
            "datetime" => typeof(DateTime),
            "boolean" => typeof(bool),
            _ => typeof(string)
        };

        public object GetValue(int i) => _currentValues[i];

        private static bool TryConvert(string type, string value, out object converted)
        {
            switch (type)
            {
                case "integer" when long.TryParse(
                    value,
                    NumberStyles.Integer,
                    CultureInfo.InvariantCulture,
                    out var integer):
                    converted = integer;
                    return true;
                case "decimal" when decimal.TryParse(
                    value,
                    NumberStyles.Number | NumberStyles.AllowExponent,
                    CultureInfo.InvariantCulture,
                    out var number):
                    converted = number;
                    return true;
                case "date" when DateOnly.TryParse(
                    value,
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.None,
                    out var dateOnly):
                    converted = dateOnly.ToDateTime(TimeOnly.MinValue);
                    return true;
                case "datetime" when DateTime.TryParse(
                    value,
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.AllowWhiteSpaces,
                    out var date):
                    converted = date;
                    return true;
                case "boolean" when TryParseBoolean(value, out var boolean):
                    converted = boolean;
                    return true;
                case "text":
                    converted = value;
                    return true;
                default:
                    converted = DBNull.Value;
                    return false;
            }
        }

        public static bool IsBoolean(string value) => TryParseBoolean(value, out _);

        private static bool TryParseBoolean(string value, out bool boolean)
        {
            switch (value.Trim().ToLowerInvariant())
            {
                case "true":
                case "yes":
                case "1":
                    boolean = true;
                    return true;
                case "false":
                case "no":
                case "0":
                    boolean = false;
                    return true;
                default:
                    boolean = false;
                    return false;
            }
        }

        private static string GetConversionError(string type) => type switch
        {
            "integer" => "Value is not a valid integer.",
            "decimal" => "Value is not a valid number.",
            "boolean" => "Value must be true/false, yes/no, or 1/0.",
            "date" => "Value is not a valid date.",
            "datetime" => "Value is not a valid date and time.",
            _ => "Value could not be converted."
        };

        private void WriteError(string? columnName, string? rawValue, string reason, long rowNumber)
        {
            var error = new CsvImportErrorRecord(
                Guid.NewGuid(),
                _datasetId,
                rowNumber,
                columnName,
                rawValue is { Length: > 2_000 } ? rawValue[..2_000] : rawValue,
                reason);
            _errorWriter.WriteLine(JsonSerializer.Serialize(error));
        }

        private void ReportProgress()
        {
            if (_onProgress is null || _fileSizeBytes <= 0)
            {
                return;
            }

            var now = DateTime.UtcNow;
            if (now - _lastProgressAt < TimeSpan.FromMilliseconds(250))
            {
                return;
            }

            _lastProgressAt = now;
            var bytesRead = Math.Clamp(_source.Position, 0, _fileSizeBytes);
            var percent = (int)Math.Min(99, bytesRead * 100 / _fileSizeBytes);
            _onProgress(percent, RowsRead);
        }

        public int GetValues(object[] values)
        {
            var count = Math.Min(values.Length, FieldCount);
            for (var index = 0; index < count; index++)
            {
                values[index] = GetValue(index);
            }

            return count;
        }

        public bool IsDBNull(int i) => GetValue(i) is DBNull;
        public bool GetBoolean(int i) => (bool)GetValue(i);
        public byte GetByte(int i) => Convert.ToByte(GetValue(i), CultureInfo.InvariantCulture);
        public char GetChar(int i) => Convert.ToChar(GetValue(i), CultureInfo.InvariantCulture);
        public DateTime GetDateTime(int i) => (DateTime)GetValue(i);
        public decimal GetDecimal(int i) => (decimal)GetValue(i);
        public double GetDouble(int i) => Convert.ToDouble(GetValue(i), CultureInfo.InvariantCulture);
        public float GetFloat(int i) => Convert.ToSingle(GetValue(i), CultureInfo.InvariantCulture);
        public Guid GetGuid(int i) => Guid.Parse(GetString(i));
        public short GetInt16(int i) => Convert.ToInt16(GetValue(i), CultureInfo.InvariantCulture);
        public int GetInt32(int i) => Convert.ToInt32(GetValue(i), CultureInfo.InvariantCulture);
        public long GetInt64(int i) => Convert.ToInt64(GetValue(i), CultureInfo.InvariantCulture);
        public string GetString(int i) => Convert.ToString(GetValue(i), CultureInfo.InvariantCulture) ?? string.Empty;
        public long GetBytes(int i, long fieldOffset, byte[]? buffer, int bufferoffset, int length) => throw new NotSupportedException();
        public long GetChars(int i, long fieldoffset, char[]? buffer, int bufferoffset, int length) => throw new NotSupportedException();
        public IDataReader GetData(int i) => throw new NotSupportedException();
        public IEnumerator GetEnumerator() => throw new NotSupportedException();
    }
}

public sealed record CsvImportResult(Dataset Dataset, long RowsSkipped, long ErrorCount);
internal sealed record CsvImportErrorRecord(
    Guid Id,
    Guid DatasetId,
    long RowNumber,
    string? ColumnName,
    string? RawValue,
    string Reason);
