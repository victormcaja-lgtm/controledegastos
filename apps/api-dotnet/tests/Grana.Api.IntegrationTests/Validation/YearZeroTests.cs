using Grana.Api.Validation;

namespace Grana.Api.IntegrationTests.Validation;

/// <summary>
/// D-06 (aprovada em 2026-10-20): o Node aceita o ano 0000, o .NET não consegue
/// representá-lo. Diferença APROVADA: responde como qualquer data inexistente.
/// </summary>
public class YearZeroTests
{
    [Fact]
    public void Ano_0000_vira_data_inexistente()
    {
        var result = RequestSchemas.TodayQuery.Validate(JsValue.FromJson(System.Text.Json.JsonDocument.Parse("""{"today":"0000-01-01"}""").RootElement));
        Assert.False(result.Success);
        Assert.Equal(["today: Data inexistente."], result.Issues.Select(i => $"{i.Path}: {i.Message}"));
    }

    [Theory]
    [InlineData("0001-01-01")]
    [InlineData("9999-12-31")]
    public void Anos_representaveis_continuam_aceitos(string date)
    {
        var result = RequestSchemas.TodayQuery.Validate(JsValue.FromJson(System.Text.Json.JsonDocument.Parse($$"""{"today":"{{date}}"}""").RootElement));
        Assert.True(result.Success);
    }
}
