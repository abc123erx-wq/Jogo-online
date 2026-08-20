# 🎮 Jogo Online

Repositório de jogos online.

## ⚽ MOD: Futebol 3D — Minecraft Bedrock 1.26.44

Mod de futebol completo para Minecraft Bedrock (comportamento + recursos + scripts):
**bola 3D animada** com física própria, **campo automático com gols e rede**, partidas com
cronômetro, placar persistente, times, estatísticas, **HAT-TRICK com fanfarra e troféu**,
menu por formulário, sons e efeitos.

👉 **Documentação completa, comandos e instalação:** [`minecraft/README.md`](minecraft/README.md)

Instalação rápida: abra `minecraft/packs/futebol-3d.mcaddon` no Minecraft e ative os dois
packs no mundo. Depois: `/fute campo` → `/fute inicio` → chute a bola e marque 3 gols! 🎩

---

## 🌐 Servidor WebSocket

Servidor WebSocket completo para jogos online multiplayer, configurado para deploy no Railway Cloud.

## 🚀 Recursos

✅ Servidor WebSocket em tempo real  
✅ Broadcast de mensagens para múltiplos clientes  
✅ Gerenciamento automático de conexões  
✅ API REST para status do servidor  
✅ Cliente web interativo para testes  
✅ Pronto para Railway Cloud Deploy  
✅ Tratamento de erros robusto  
✅ Logs detalhados de eventos  

## 📋 Requisitos

- Node.js 18+ 
- npm ou yarn

## 🛠️ Instalação Local

```bash
# Clone o repositório
git clone https://github.com/abc123erx-wq/Jogo-online
cd Jogo-online

# Instale as dependências
npm install

# Crie o arquivo .env
cp .env.example .env

# Inicie o servidor
npm start
```

O servidor estará rodando em `http://localhost:3000`

## 🎯 Endpoints

### REST API

```bash
# Health Check
GET /health

# Contar clientes conectados
GET /api/clients
```

### WebSocket

```
ws://localhost:3000
```

## 📱 Cliente de Teste

Abra `client-example.html` no navegador para acessar o cliente interativo.

**Recursos:**
- Conectar/Desconectar do servidor
- Enviar mensagens personalizadas
- Movimento do personagem
- Ataques
- Chat em tempo real
- Visualizar logs de conexão

## 📨 Formato de Mensagens

### Exemplo de Movimento

```json
{
  "type": "playerMove",
  "data": {
    "x": 100,
    "y": 200,
    "direction": "right"
  }
}
```

### Exemplo de Ataque

```json
{
  "type": "playerAttack",
  "data": {
    "target": "enemy",
    "damage": 25
  }
}
```

### Exemplo de Chat

```json
{
  "type": "playerChat",
  "data": {
    "text": "Olá pessoal!"
  }
}
```

## 🚢 Deploy no Railway

### Método 1: Via GitHub (Recomendado)

1. Faça push do repositório para GitHub
2. Acesse [Railway.app](https://railway.app)
3. Clique em "New Project" → "Deploy from GitHub repo"
4. Selecione seu repositório `Jogo-online`
5. Railway detectará automaticamente e fará o deploy

### Método 2: Via Railway CLI

```bash
# Instale o Railway CLI
npm install -g @railway/cli

# Faça login
railway login

# Inicialize o projeto
railway init

# Faça o deploy
railway up
```

### Variáveis de Ambiente no Railway

No painel do Railway, adicione:

```
PORT=3000
NODE_ENV=production
```

## 📊 Monitoramento

### Logs do Servidor

O servidor exibe logs detalhados:

```
[2026-05-20T21:30:00.000Z] Cliente conectado: client_1 (Total: 5)
[2026-05-20T21:30:05.000Z] Mensagem de client_1: {"type":"playerMove",...}
[2026-05-20T21:30:10.000Z] Cliente desconectado: client_1 (Mensagens: 3)
```

### Health Check

```bash
curl https://seu-servidor.railway.app/health
```

Resposta:

```json
{
  "status": "ok",
  "timestamp": "2026-05-20T21:30:00.000Z",
  "uptime": 300.5
}
```

## 🔧 Configuração

### PORT

Por padrão, o servidor usa a porta `3000`. No Railway, use a variável `PORT` que é atribuída automaticamente.

### NODE_ENV

- `development`: Logs verbosos
- `production`: Logs otimizados

## 🧪 Teste de Carga

Para testar com múltiplos clientes:

1. Abra `client-example.html` em várias abas do navegador
2. Conecte cada uma ao mesmo servidor
3. Envie mensagens e observe o broadcast

## 📝 Estrutura do Projeto

```
Jogo-online/
├── server.js           # Servidor principal
├── client-example.html # Cliente web de teste
├── package.json        # Dependências
├── railway.json        # Config do Railway
├── Procfile           # Processo para Railway
├── .env.example       # Variáveis de exemplo
└── README.md          # Este arquivo
```

## 🐛 Troubleshooting

### "Erro ao conectar: WebSocket está fechado"

- Verifique se o servidor está rodando
- Confira a URL do servidor
- Verifique firewall/CORS

### "Mensagens não chegam em outros clientes"

- Confirme que os clientes estão conectados (`status: conectado`)
- Verifique o console do navegador para erros
- Veja os logs do servidor

### Porta já em uso

```bash
# Linux/Mac: Matar processo na porta 3000
lsof -ti:3000 | xargs kill -9

# Windows: Matar processo na porta 3000
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

## 📚 Documentação

- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [Express.js](https://expressjs.com/)
- [Railway Docs](https://docs.railway.app/)
- [ws Library](https://github.com/websockets/ws)

## 📄 Licença

MIT

## 💬 Suporte

Para problemas ou dúvidas, abra uma issue no GitHub.

---

**Desenvolvido com ❤️ para jogos online multiplayer**
