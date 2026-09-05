#!/usr/bin/env bash
# Opt-in POSIX development installation. Run on the desktop host after verification.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
saved_destination=''
saved_harness=''
if [[ -f "$repo/.impulse-install.json" ]]; then
  saved_destination="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["destination"])' "$repo/.impulse-install.json")"
  saved_harness="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["harness"])' "$repo/.impulse-install.json")"
fi
destination="${IMPULSE_INSTALL_BIN:-${saved_destination:-$HOME/.local/bin/impulse}}"
harness="${IMPULSE_INSTALL_HARNESS:-${saved_harness:-codex}}"
engine="${CONTAINER_ENGINE:-docker}"
image='impulse-local-dev:1.4.1'

if [[ "$(uname -s)" != Linux ]]; then
  printf 'This container-to-host installer requires Linux. Build natively for other operating systems.\n' >&2
  exit 2
fi
if [[ -e "$destination" && "$destination" != "$saved_destination" ]]; then
  printf 'An unmanaged executable already exists at %s. Preserve it before opting into this installer.\n' "$destination" >&2
  exit 1
fi
"$engine" build -t "$image" -f "$repo/.devcontainer/Dockerfile" "$repo"
user_args=(--user "$(id -u):$(id -g)")
# Podman's Docker-compatible executable identifies itself as "docker" in --version.
if [[ "$("$engine" info --format '{{.Host.Security.Rootless}}' 2>/dev/null || true)" == true ]]; then user_args=(--userns=keep-id); fi
"$engine" run --rm "${user_args[@]}" -v "$repo:/workspaces/impulse" -w /workspaces/impulse "$image" bun install --frozen-lockfile
"$engine" run --rm "${user_args[@]}" -v "$repo:/workspaces/impulse" -w /workspaces/impulse "$image" bun run build

# Verify skill ownership before stopping dispatch or replacing the installed executable.
"$repo/dist/impulse" skill install --harness "$harness" --scope user --json

restart=false
if [[ -x "$destination" ]]; then
  restart="$("$destination" daemon status --json | python3 -c 'import json,sys; print(str(json.load(sys.stdin)["data"]["running"]).lower())')"
  if [[ "$restart" == true ]]; then "$destination" daemon stop --json; fi
fi
mkdir -p "$(dirname "$destination")"
temporary="$(mktemp "$(dirname "$destination")/.impulse-install.XXXXXX")"
trap 'rm -f -- "$temporary"' EXIT
cp -- "$repo/dist/impulse" "$temporary"
chmod 755 "$temporary"
"$temporary" --version --json
mv -f -- "$temporary" "$destination"
if [[ "$restart" == true ]]; then "$destination" daemon start --json; fi
python3 - "$repo" "$destination" "$harness" <<'PY'
import hashlib,json,pathlib,subprocess,sys
repo,destination,harness=sys.argv[1:]
receipt={'source':repo,'destination':destination,'harness':harness,
         'sha256':hashlib.sha256(pathlib.Path(destination).read_bytes()).hexdigest(),
         'revision':subprocess.check_output(['git','-C',repo,'rev-parse','HEAD'],text=True).strip()}
pathlib.Path(repo,'.impulse-install.json').write_text(json.dumps(receipt,indent=2)+'\n')
print('Installed '+destination+'; Codex skill refreshed.' if harness=='codex' else 'Installed '+destination+'; selected skill refreshed.')
PY
