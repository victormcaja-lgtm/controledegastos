#!/usr/bin/env bash
# Roda o `dotnet` dentro do contêiner oficial do SDK 10 (Linux).
#
# Por que: nesta máquina o Smart App Control do Windows bloqueia DLLs recém-
# compiladas e sem assinatura, o que impede rodar testes e a API no host.
# O contêiner também é o mesmo ambiente do CI e da Railway.
#
# Uso (de qualquer pasta):  bash apps/api-dotnet/scripts/dotnet.sh test
#                           bash apps/api-dotnet/scripts/dotnet.sh build
# Variáveis repassadas: as que começam com GRANA_, PARITY_ e ConnectionStrings__.
set -euo pipefail

# `pwd -W` dá o caminho no formato do Windows (C:/...) no Git Bash; no Linux, `pwd`.
repo="$(cd "$(dirname "$0")/../../.." && { pwd -W 2>/dev/null || pwd; })"
envs=()
while IFS='=' read -r name _; do
  case "$name" in GRANA_*|PARITY_*|ConnectionStrings__*|TESTCONTAINERS_*) envs+=(-e "$name");; esac
done < <(env)

MSYS_NO_PATHCONV=1 exec docker run --rm ${DOTNET_DOCKER_FLAGS:-} \
  -v "${repo}:/src" \
  -v grana-nuget:/root/.nuget/packages \
  -v //var/run/docker.sock:/var/run/docker.sock \
  -e DOTNET_CLI_TELEMETRY_OPTOUT=1 -e DOTNET_NOLOGO=1 \
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal \
  "${envs[@]}" \
  -w /src/apps/api-dotnet \
  mcr.microsoft.com/dotnet/sdk:10.0 dotnet "$@"
