namespace Grana.Application.Health;

/// <summary>Porta: o health check precisa tocar o banco (RN-018).</summary>
public interface IDatabaseHealth
{
    /// <summary>Executa <c>SELECT 1</c>; lança se o banco estiver fora.</summary>
    Task PingAsync(CancellationToken cancellationToken);
}
