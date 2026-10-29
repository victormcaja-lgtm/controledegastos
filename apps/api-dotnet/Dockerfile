# API .NET do Grana (fachada Strangler Fig). Contexto de build: apps/api-dotnet.
#   docker build -t grana-api-dotnet apps/api-dotnet
# Configuração só por variáveis de ambiente (docs/DEPLOY.md, Etapa 8).

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
# Restaura antes de copiar o código: a camada de pacotes só muda quando um .csproj muda.
COPY Directory.Build.props .editorconfig ./
COPY src/Grana.Domain/Grana.Domain.csproj src/Grana.Domain/
COPY src/Grana.Application/Grana.Application.csproj src/Grana.Application/
COPY src/Grana.Infrastructure/Grana.Infrastructure.csproj src/Grana.Infrastructure/
COPY src/Grana.Api/Grana.Api.csproj src/Grana.Api/
RUN dotnet restore src/Grana.Api/Grana.Api.csproj
COPY src/ src/
RUN dotnet publish src/Grana.Api/Grana.Api.csproj -c Release --no-restore -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    DOTNET_gcServer=0
COPY --from=build /app .
# Usuário sem privilégios que a própria imagem oficial já traz.
USER $APP_UID
ENTRYPOINT ["dotnet", "Grana.Api.dll"]
