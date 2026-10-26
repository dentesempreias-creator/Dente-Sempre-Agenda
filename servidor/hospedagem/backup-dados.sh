#!/bin/bash
# Cópia diária do Dente Sempre (agendada pelo instalar-vps.sh às 03:15).
# 1) pede ao próprio servidor uma cópia segura dos bancos (todas as clínicas + a chave das licenças);
# 2) compacta essa cópia em /var/backups/dente-sempre e guarda 30 dias;
# 3) se o rclone estiver configurado, manda também para fora do servidor (Google Drive, Dropbox, S3...).
set -euo pipefail
PASTA=${PASTA:-/opt/dente-sempre-servidor}
DESTINO=${DESTINO:-/var/backups/dente-sempre}
DIAS=${DIAS:-30}
mkdir -p "$DESTINO"; chmod 700 "$DESTINO"
COPIA=$(cd "$PASTA" && sudo -u dentesempre node servidor.js copia | sed -n 's/^Cópia feita em: //p' | tail -1)
if [ -z "$COPIA" ] || [ ! -d "$COPIA" ]; then echo "ERRO: o servidor não fez a cópia" >&2; exit 1; fi
ARQ="$DESTINO/dente-sempre-$(date +%Y-%m-%d-%H%M).tar.gz"
tar -czf "$ARQ" -C "$(dirname "$COPIA")" "$(basename "$COPIA")"
chmod 600 "$ARQ"
find "$DESTINO" -name 'dente-sempre-*.tar.gz' -mtime +"$DIAS" -delete
# Cópia fora do servidor (opcional): crie /etc/dente-sempre-backup.conf com RCLONE_DESTINO=nome:pasta
CONF=${CONF:-/etc/dente-sempre-backup.conf}
if [ -f "$CONF" ]; then
  . "$CONF"
  if [ -n "${RCLONE_DESTINO:-}" ] && command -v rclone >/dev/null; then
    rclone copy "$ARQ" "$RCLONE_DESTINO" && rclone delete --min-age "${DIAS}d" "$RCLONE_DESTINO" || echo "Aviso: a cópia para fora do servidor falhou" >&2
  fi
fi
echo "Cópia feita: $ARQ"
