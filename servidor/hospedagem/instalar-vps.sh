#!/bin/bash
# =====================================================================
#  Instala o servidor do Dente Sempre num Ubuntu (22.04 ou 24.04) com HTTPS.
#  Uso (dentro da pasta "servidor", como root):
#     bash hospedagem/instalar-vps.sh api.seudominio.com.br
#  Antes: aponte o domínio (registro A) para o IP deste servidor.
#  Depois: crie clínicas com   dente-sempre nova-clinica "Nome da clínica"
# =====================================================================
set -euo pipefail
DOMINIO="${1:-}"
if [ -z "$DOMINIO" ]; then echo "Use: bash hospedagem/instalar-vps.sh api.seudominio.com.br"; exit 1; fi
if [ "$(id -u)" != "0" ]; then echo "Rode como root (sudo -i)."; exit 1; fi
ORIGEM="$(cd "$(dirname "$0")/.." && pwd)"
DESTINO=/opt/dente-sempre-servidor

echo "== 1/6 Atualizando o sistema e instalando o básico"
apt-get update -y
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https ufw sudo

echo "== 2/6 Node.js 22 ou mais novo (o banco SQLite já vem dentro dele)"
if ! command -v node >/dev/null || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh
  apt-get install -y nodejs
fi
node --version

echo "== 3/6 Caddy (HTTPS automático com Let's Encrypt)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "== 4/6 Copiando o servidor para $DESTINO"
id dentesempre >/dev/null 2>&1 || useradd --system --home "$DESTINO" --shell /usr/sbin/nologin dentesempre
mkdir -p "$DESTINO/dados"
if [ "$ORIGEM" != "$DESTINO" ]; then
  cp -r "$ORIGEM/servidor.js" "$ORIGEM/certificado.js" "$ORIGEM/planos.js" "$ORIGEM/paciente.js" "$ORIGEM/area.js" "$ORIGEM/package.json" "$ORIGEM/hospedagem" "$DESTINO/"
  cp "$ORIGEM/pagamento.js" "$ORIGEM/painel.js" "$DESTINO/"
fi
chown -R root:root "$DESTINO"
chown -R dentesempre:dentesempre "$DESTINO/dados"
chmod 700 "$DESTINO/dados"
# "dente-sempre <comando>" roda os comandos do servidor como o usuário do serviço,
# para os arquivos novos de clínica ficarem com o dono certo. Funciona com o servidor ligado.
cat > /usr/local/bin/dente-sempre <<EOS
#!/bin/bash
cd $DESTINO && exec sudo -u dentesempre node servidor.js "\$@"
EOS
chmod 755 /usr/local/bin/dente-sempre

# Senhas e tokens (painel e Mercado Pago) ficam fora do código, só para o root ler
if [ ! -f /etc/dente-sempre.env ]; then
  cat > /etc/dente-sempre.env <<EOS
# Configuração secreta do Dente Sempre. Depois de mudar: systemctl restart dente-sempre
ENDERECO_PUBLICO=https://$DOMINIO
# Senha do painel (https://$DOMINIO/painel), pelo menos 12 caracteres
PAINEL_SENHA=$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 20)
# Mercado Pago (veja o README, seção Pagamento)
MP_ACCESS_TOKEN=
MP_WEBHOOK_SEGREDO=
PRECO_BASICO=
PRECO_PROFISSIONAL=
EOS
  chmod 600 /etc/dente-sempre.env
fi

echo "== 5/6 Ligando os serviços"
cp "$DESTINO/hospedagem/dente-sempre.service" /etc/systemd/system/dente-sempre.service
sed "s/api.seudominio.com.br/$DOMINIO/" "$DESTINO/hospedagem/Caddyfile" > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now dente-sempre
systemctl restart caddy

echo "== 6/6 Firewall e cópia diária"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
install -m 755 "$DESTINO/hospedagem/backup-dados.sh" /usr/local/bin/dente-sempre-backup
echo "15 3 * * * root /usr/local/bin/dente-sempre-backup >> /var/log/dente-sempre-backup.log 2>&1" > /etc/cron.d/dente-sempre-backup

sleep 3
echo
echo "Pronto! Servidor em: https://$DOMINIO   (teste: https://$DOMINIO/api/situacao)"
echo
echo "Chave pública das licenças (vai no app/config.json antes de gerar os aplicativos):"
dente-sempre chave-publica || true
echo
echo "Criar a primeira clínica:   dente-sempre nova-clinica \"Nome da clínica\" --plano basico"
echo "Ver se está ligado:  systemctl status dente-sempre    |  Registros:  journalctl -u dente-sempre -f"
echo "IMPORTANTE: guarde uma cópia de $DESTINO/dados/licenca-privada.pem fora do servidor."
echo "Painel: https://$DOMINIO/painel  (a senha está em /etc/dente-sempre.env, linha PAINEL_SENHA)"
