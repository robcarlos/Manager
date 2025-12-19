import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());

const useMock = process.env.MOCK_DB === '1';
let db;
let memory = [];

function splitIdentificador(ident){
  if(!ident) return { service_tag:'', imei:'' };
  const isImei = /^\d{10,}$/.test(ident);
  return isImei ? { service_tag:'', imei: ident } : { service_tag: ident, imei:'' };
}

async function initDB(){
  if(useMock){
    memory = [
      { id:1, tipo:'Notebook', localizacao:'Palmas-Escritório', fabricante:'Dell', modelo:'Latitude 3490', service_tag:'ABC123', imei:'', centro_custo:'CC-100', estado:'EM USO' },
      { id:2, tipo:'Celular', localizacao:'Miracema Usina', fabricante:'Samsung', modelo:'A34', service_tag:'', imei:'359876543210123', centro_custo:'CC-200', estado:'Estoque' },
    ];
    return;
  }
  db = await mysql.createConnection({
    host: process.env.DB_HOST || 'db',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || 'root',
    database: process.env.DB_NAME || 'investco_db',
  });
  await db.execute(`CREATE TABLE IF NOT EXISTS equipamentos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tipo VARCHAR(50), localizacao VARCHAR(80), fabricante VARCHAR(80),
    modelo VARCHAR(120), service_tag VARCHAR(120), imei VARCHAR(32),
    centro_custo VARCHAR(80), estado VARCHAR(40)
  )`);
}

app.get('/api/equipamentos', async (req,res)=>{
  const { page=1, pageSize=10, tipo, localizacao, fabricante, modelo, tag, imei, centro_custo } = req.query;
  const p = parseInt(page); const ps = parseInt(pageSize);
  if(useMock){
    let data = memory.slice();
    const like = (v,q)=>!q || (v||'').toLowerCase().includes((q||'').toLowerCase());
    data = data.filter(e => (!tipo || e.tipo===tipo) &&
      (!localizacao || e.localizacao===localizacao) &&
      (!fabricante || e.fabricante===fabricante) &&
      (!modelo || e.modelo===modelo) &&
      like(e.service_tag, tag) && like(e.imei, imei) && like(e.centro_custo, centro_custo));
    const total = data.length;
    const pageData = data.slice((p-1)*ps, p*ps);
    return res.json({ total, page:p, data: pageData });
  }else{
    let where = []; let params=[];
    if(tipo) { where.push('tipo=?'); params.push(tipo); }
    if(localizacao){ where.push('localizacao=?'); params.push(localizacao); }
    if(fabricante){ where.push('fabricante=?'); params.push(fabricante); }
    if(modelo){ where.push('modelo=?'); params.push(modelo); }
    if(tag){ where.push('service_tag LIKE ?'); params.push('%'+tag+'%'); }
    if(imei){ where.push('imei LIKE ?'); params.push('%'+imei+'%'); }
    if(centro_custo){ where.push('centro_custo LIKE ?'); params.push('%'+centro_custo+'%'); }
    const whereSql = where.length ? 'WHERE '+where.join(' AND ') : '';
    const [rows] = await db.query(`SELECT * FROM equipamentos ${whereSql} LIMIT ? OFFSET ?`, [...params, ps, (p-1)*ps]);
    const [[{cnt}]] = await db.query(`SELECT COUNT(*) as cnt FROM equipamentos ${whereSql}`, params);
    res.json({ total: cnt, page:p, data: rows });
  }
});

app.post('/api/equipamentos', async (req,res)=>{
  const { tipo, fabricante, modelo, localizacao, service_tag, imei, identificador, centro_custo, estado } = req.body;
  const ids = splitIdentificador(identificador || service_tag || imei);
  if(useMock){
    const id = (memory.reduce((m,e)=>Math.max(m,e.id),0) || 0)+1;
    memory.push({ id, tipo, fabricante, modelo, localizacao, service_tag: ids.service_tag, imei: ids.imei, centro_custo: centro_custo||'', estado: estado||'EM USO' });
    return res.json({ id });
  }else{
    const [r] = await db.query(
      `INSERT INTO equipamentos (tipo,fabricante,modelo,localizacao,service_tag,imei,centro_custo,estado) VALUES (?,?,?,?,?,?,?,?)`,
      [tipo,fabricante,modelo,localizacao,ids.service_tag,ids.imei,centro_custo||'',estado||'EM USO']
    );
    res.json({ id: r.insertId });
  }
});

app.put('/api/equipamentos/:id', async (req,res)=>{
  const { id } = req.params;
  const { tipo, fabricante, modelo, localizacao, service_tag, imei, identificador, centro_custo, estado } = req.body;
  const ids = splitIdentificador(identificador || service_tag || imei);
  if(useMock){
    const i = memory.findIndex(x=>x.id==id);
    if(i>=0){ memory[i] = { ...memory[i], tipo, fabricante, modelo, localizacao, service_tag: ids.service_tag, imei: ids.imei, centro_custo, estado }; }
    return res.json({ ok:true });
  }else{
    await db.query(
      `UPDATE equipamentos SET tipo=?,fabricante=?,modelo=?,localizacao=?,service_tag=?,imei=?,centro_custo=?,estado=? WHERE id=?`,
      [tipo,fabricante,modelo,localizacao,ids.service_tag,ids.imei,centro_custo,estado,id]
    );
    res.json({ ok:true });
  }
});

app.delete('/api/equipamentos/:id', async (req,res)=>{
  const { id } = req.params;
  if(useMock){
    memory = memory.filter(x=>x.id!=id);
    return res.json({ ok:true });
  }else{
    await db.query('DELETE FROM equipamentos WHERE id=?',[id]);
    res.json({ ok:true });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
const PORT = process.env.PORT || 8080;
initDB().then(()=>{
  app.listen(PORT, ()=>console.log('Portal Investco/EDP em http://localhost:'+PORT));
}).catch(e=>{ console.error('DB init error', e); process.exit(1); });


app.get('/api/inventario/logs', requireInventarioJson, async (req,res)=>{
  try{
    const limitRaw = (req.query.limit || '100').toString();
    let limit = parseInt(limitRaw, 10);
    if(!Number.isFinite(limit) || limit <= 0) limit = 100;
    if(limit > 500) limit = 500;

    if(!useMock){
      const [rows] = await db.query(
        `SELECT
           id,
           data_hora,
           email_log        AS email,
           ip,
           sucesso,
           mensagem,
           login_edp,
           nome,
           notebook_modelo,
           notebook_tag,
           notebook_hostname
         FROM vw_inventario_acessos
         ORDER BY data_hora DESC
         LIMIT ?`,
        [limit]
      );
      return res.json({ rows });
    }else{
      return res.json({ rows: [] });
    }
  }catch(err){
    console.error('Erro em /api/inventario/logs', err);
    return res.status(500).json({ error:'Falha ao carregar relatório de acessos.' });
  }
});
