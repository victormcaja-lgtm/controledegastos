using System.Text.Json;
using Grana.Api.Json;

namespace Grana.Api.IntegrationTests.Json;

public class GranaJsonTests
{
    private static readonly JsonSerializerOptions Options = GranaJson.CreateOptions();

    private sealed record Sample(DateTime CreatedAt, DateOnly OccurredOn, string? Note, string Message);

    [Fact]
    public void Serializa_como_a_API_Node()
    {
        var value = new Sample(
            new DateTime(2026, 10, 20, 13, 5, 9, DateTimeKind.Utc).AddTicks(1_234_567),
            new DateOnly(2026, 3, 3),
            null,
            "−R$ 10,00 · março");

        Assert.Equal(
            "{\"createdAt\":\"2026-10-20T13:05:09.123Z\",\"occurredOn\":\"2026-03-03\",\"note\":null,\"message\":\"−R$ 10,00 · março\"}",
            JsonSerializer.Serialize(value, Options));
    }

    [Fact]
    public void Data_sem_fuso_e_tratada_como_UTC() =>
        Assert.Equal(
            "\"2026-01-02T03:04:05.000Z\"",
            JsonSerializer.Serialize(new DateTime(2026, 1, 2, 3, 4, 5, DateTimeKind.Unspecified), Options));
}
