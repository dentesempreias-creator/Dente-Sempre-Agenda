# Dente Sempre — servidor (para Fly.io, Railway, Render ou qualquer lugar com Docker)
# Sem dependências: só o Node 22 (o banco SQLite já vem dentro do Node).
FROM node:22-alpine
WORKDIR /app
COPY servidor.js certificado.js planos.js paciente.js area.js package.json ./
COPY pagamento.js painel.js ./
COPY assinatura.js ./
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORTA=3000 \
    PASTA_DADOS=/app/dados \
    CONFIAR_PROXY=1
# A pasta dados PRECISA ser um volume (disco que não some quando o app é atualizado)
RUN mkdir -p /app/dados && chown -R node:node /app/dados
USER node
VOLUME ["/app/dados"]
EXPOSE 3000
CMD ["node", "servidor.js"]
