using System.Text.Json;
using System.Text.Json.Nodes;
using Grana.Api.Validation;

namespace Grana.Api.IntegrationTests.Validation;

/// <summary>
/// Paridade da validação: cada caso de zod-golden.json foi produzido rodando os
/// schemas reais de packages/shared no Zod (tools/zod-golden/generate.mjs).
/// O ZodCompat precisa dar exatamente o mesmo resultado — dados de saída ou a
/// lista ordenada de {path, message}.
/// </summary>
public class ZodGoldenTests
{
    private static readonly JsonDocument Golden = JsonDocument.Parse(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Validation", "zod-golden.json")));

    public static TheoryData<string> SchemaNames()
    {
        var data = new TheoryData<string>();
        foreach (var schema in Golden.RootElement.GetProperty("cases").EnumerateObject()) data.Add(schema.Name);
        return data;
    }

    [Fact]
    public void Todo_schema_do_golden_existe_no_dotnet()
    {
        var missing = Golden.RootElement.GetProperty("cases").EnumerateObject()
            .Select(schema => schema.Name)
            .Where(name => !RequestSchemas.All.ContainsKey(name))
            .ToList();
        Assert.Empty(missing);
    }

    [Theory]
    [MemberData(nameof(SchemaNames))]
    public void Mesmo_resultado_do_Zod(string schemaName)
    {
        var schema = RequestSchemas.All[schemaName];
        var failures = new List<string>();

        foreach (var testCase in Golden.RootElement.GetProperty("cases").GetProperty(schemaName).EnumerateArray())
        {
            var rawInput = testCase.GetProperty("input");
            var input = rawInput.ValueKind == JsonValueKind.Object && rawInput.TryGetProperty("$undefined", out _)
                ? JsUndefined.Instance
                : JsValue.FromJson(rawInput);
            var result = schema.Validate(input);
            var expectedSuccess = testCase.GetProperty("success").GetBoolean();

            string? problem = null;
            if (result.Success != expectedSuccess)
            {
                problem = $"success esperado {expectedSuccess}, veio {result.Success}: {Describe(result)}";
            }
            else if (expectedSuccess)
            {
                var expected = JsonNode.Parse(testCase.GetProperty("data").GetRawText());
                if (!JsonNode.DeepEquals(Normalize(expected), Normalize(result.Data.ToJsonNode())))
                {
                    problem = $"dados esperados {expected?.ToJsonString()}, veio {result.Data.ToJsonNode()?.ToJsonString()}";
                }
            }
            else
            {
                var expected = testCase.GetProperty("issues").EnumerateArray()
                    .Select(i => $"{i.GetProperty("path").GetString()}: {i.GetProperty("message").GetString()}")
                    .ToList();
                var actual = result.Issues.Select(i => $"{i.Path}: {i.Message}").ToList();
                if (!expected.SequenceEqual(actual))
                {
                    problem = $"esperado [{string.Join(" | ", expected)}], veio [{string.Join(" | ", actual)}]";
                }
            }

            if (problem is not null) failures.Add($"{rawInput.GetRawText()} → {problem}");
        }

        Assert.True(failures.Count == 0, $"{failures.Count} divergência(s) em {schemaName}:\n{string.Join('\n', failures.Take(15))}");
    }

    private static string Describe(ValidationResult result) =>
        result.Success ? result.Data.ToJsonNode()?.ToJsonString() ?? "undefined" : string.Join(" | ", result.Issues.Select(i => $"{i.Path}: {i.Message}"));

    /// <summary>Números comparados pelo valor (1 e 1.0 são o mesmo número em JSON/JS).</summary>
    private static JsonNode? Normalize(JsonNode? node) => node switch
    {
        JsonObject obj => new JsonObject(obj.Select(p => KeyValuePair.Create(p.Key, Normalize(p.Value)))),
        JsonArray array => new JsonArray([.. array.Select(Normalize)]),
        JsonValue value when value.GetValueKind() == JsonValueKind.Number => JsonValue.Create(value.GetValue<double>()),
        JsonValue value => JsonNode.Parse(value.ToJsonString()),
        _ => null,
    };
}
