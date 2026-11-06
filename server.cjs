'use strict';
const http=require('node:http');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {createStore,handoff}=require('./portable-store.cjs');
function createServer(store=createStore()) {
  const assets={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};
  let handedOff=false;
  const server = http.createServer(async(req,res)=>{
    const send=(status,data,type='application/json')=>{
      res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        'Referrer-Policy':'no-referrer'});
      res.end(type==='application/json'?JSON.stringify(data):data);
    };
    try {
      const authority='127.0.0.1:'+serverPort(req);
      if(req.headers.host!==authority && req.headers.host!=='localhost:'+serverPort(req)) return send(403,{error:'Local access only.'});
      if(req.headers.origin && req.headers.origin!=='http://'+req.headers.host) return send(403,{error:'Same-origin access only.'});
      const url=new URL(req.url,'http://'+authority);
      if(req.method==='GET' && assets[url.pathname]) {
        const [file,type]=assets[url.pathname]; return send(200,readFileSync(join(__dirname,'public',file)),type);
      }
      if(req.method==='GET' && url.pathname==='/api/state') return send(200,store.read());
      if(req.method==='GET' && url.pathname==='/api/export') {
        res.setHeader('Content-Disposition','attachment; filename="waypoint-history.json"');
        return send(200,store.read());
      }
      if(req.method==='POST') {
        if(!req.headers['content-type']?.startsWith('application/json')) return send(415,{error:'Send application/json.'});
        const chunks=[];let size=0;
        for await(const chunk of req) { size+=chunk.length;if(size>2_000_000)return send(413,{error:'File is too large (maximum 2 MB).'});chunks.push(chunk); }
        const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(!input || typeof input!=='object' || Array.isArray(input))return send(400,{error:'Send a JSON object.'});
        if(handedOff) return send(409,{error:'This device has handed off. Restart Waypoint when you return to it.'});
        if(url.pathname==='/api/handoff') {
          const result=handoff(store,store.directory?join(store.directory,'handoffs'):undefined);
          handedOff=true;send(200,result);
          server.close(()=>store.close());return;
        }
        if(url.pathname==='/api/configure') { if(store.read().tasks.some(t=>t.id===input.config?.id) && input.revision===undefined) return send(409,{error:'Updating an existing task requires its current revision. Reload the task or include expectedRevision in the imported file.'}); return send(200,store.configure(input.config,input.revision)); }
        if(url.pathname==='/api/action') return send(200,store.action(input));
        if(url.pathname==='/api/project') return send(200,store.projectAction(input));
        if(url.pathname==='/api/legacy') return send(200,store.importLegacy(input));
      }
      send(404,{error:'Not found.'});
    } catch(error) { send(error.status || (error instanceof SyntaxError?400:500),{error:error.status || error instanceof SyntaxError?error.message:'Unable to save. Check the server window and disk space.'}); if(!error.status && !(error instanceof SyntaxError)) console.error(error); }
  });
  // Keep focus alive independently of browser tab scheduling. settle() still
  // caps a sleep/crash gap before tick() can renew the server lease.
  let timer;
  server.on('listening',()=>{
    timer=setInterval(()=>{if(!handedOff){try{store.tick();}catch(error){console.error(error.message);}}},5000);
    timer.unref();
  });
  server.on('close',()=>clearInterval(timer));
  return server;
}
function serverPort(req){ return req.socket.localPort; }
if(require.main===module) {
  const port=Number(process.env.PORT || 4317);
  if(!Number.isInteger(port)||port<1||port>65535) throw Error('PORT must be 1–65535.');
  const server=createServer();
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Waypoint may already be running. Open http://127.0.0.1:'+port:error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log('Waypoint is ready at http://127.0.0.1:'+port+'\nKeep this process running while you work.'));
}
module.exports={createServer};
