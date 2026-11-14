using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using DataLens.Domain.Entities;
using Microsoft.IdentityModel.Tokens;

namespace DataLens.Api.Auth;

public sealed class AccessTokenService(IConfiguration configuration)
{
    public string Create(AppUser user)
    {
        var key = configuration["Jwt:SigningKey"]
            ?? throw new InvalidOperationException("Jwt:SigningKey is required.");
        var issuer = configuration["Jwt:Issuer"] ?? "DataLens";
        var audience = configuration["Jwt:Audience"] ?? "DataLens.Web";
        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
            SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer,
            audience,
            [
                new Claim(JwtRegisteredClaimNames.Sub, user.Id),
                new Claim(ClaimTypes.NameIdentifier, user.Id),
                new Claim(JwtRegisteredClaimNames.Email, user.Email ?? string.Empty),
                new Claim(ClaimTypes.Name, user.UserName ?? user.Email ?? string.Empty),
                new Claim("given_name", user.FirstName),
                new Claim("family_name", user.LastName)
            ],
            expires: DateTime.UtcNow.AddMinutes(30),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
