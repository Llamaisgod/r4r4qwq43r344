// game.js

window.__gameLoaded = true;

document.addEventListener('DOMContentLoaded', () => { (function(){

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
let W = canvas.width = 1920,
    H = canvas.height = 1080;
window.addEventListener('resize', () => {});

const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const rand = (a,b=0)=> b===0 ? Math.random()*a : a + Math.random()*(b-a);
const randi = (a,b)=> Math.floor(rand(a,b));
const dist = (x1,y1,x2,y2)=> Math.hypot(x1-x2,y1-y2);

const keys = {}; let keyPress = {}; const mouse = { x:0, y:0, down:false };
window.addEventListener('keydown', e=>{ if(!keys[e.key]) keyPress[e.key]=true; keys[e.key]=true; });
window.addEventListener('keyup', e=>{ keys[e.key]=false; });
window.addEventListener('mousemove', e=>{ mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener('mousedown', e=>{ mouse.down = true; });
window.addEventListener('mouseup', e=>{ mouse.down = false; });

let lastTime = performance.now(), fps = 0, frames = 0, fpsTimer = 0;
// Attack speed firing throttle (ms timestamps per player)
let nextFireTime = {};
const Scheduler = { tasks: [], schedule(delay, fn){ this.tasks.push({runAt: performance.now()+delay, fn}); }, update(){ const now = performance.now(); for(let i=this.tasks.length-1;i>=0;i--){ if(now >= this.tasks[i].runAt){ try{ this.tasks[i].fn(); }catch(e){ console.error(e); } this.tasks.splice(i,1); } } } };

const MapTemplates = [
  // Note: lavaYFrac defines where lava starts as fraction of canvas height

  { id:0, name:'Training Grounds', platforms:[ {cx:0.25,cy:0.72,wFrac:0.24,h:28, lavaYFrac: 0.9 },{cx:0.75,cy:0.72,wFrac:0.24,h:28},{cx:0.5,cy:0.48,wFrac:0.26,h:28}], spawnA:{cx:0.2,cy:0.5}, spawnB:{cx:0.8,cy:0.5} },
  { id:1, name:'Sky Islands', platforms:[ {cx:0.18,cy:0.66,wFrac:0.2,h:20, lavaYFrac: 0.9 },{cx:0.5,cy:0.5,wFrac:0.22,h:20},{cx:0.82,cy:0.66,wFrac:0.2,h:20}], spawnA:{cx:0.18,cy:0.46}, spawnB:{cx:0.82,cy:0.46} },
  { id:2, name:'Lava Pit', platforms:[ {cx:0.25,cy:0.70,wFrac:0.26,h:26, lavaYFrac: 0.9 },{cx:0.75,cy:0.70,wFrac:0.26,h:26}], spawnA:{cx:0.2,cy:0.48}, spawnB:{cx:0.8,cy:0.48}, lavaYFrac:0.9 }
];
let Maps = [], currentMap = null;
function rebuildMapsAndCenter(){ Maps = MapTemplates.map(t=>{ const platforms = t.platforms.map(p=>{ const w = Math.max(80, Math.round(p.wFrac * W)); const h = p.h; const x = Math.round(p.cx * W - w/2); const y = Math.round(p.cy * H - h/2); return {x,y,w,h}; }); const spawnA = { x: Math.round(t.spawnA.cx * W), y: Math.round(t.spawnA.cy * H) }; const spawnB = { x: Math.round(t.spawnB.cx * W), y: Math.round(t.spawnB.cy * H) }; const map = { id:t.id, name:t.name, platforms, spawnA, spawnB, gravity:0.45, lavaY: t.lavaYFrac ? Math.round(t.lavaYFrac * H) : null }; const minX = Math.min(...platforms.map(p=>p.x)); const maxX = Math.max(...platforms.map(p=>p.x + p.w)); const groupCenter = (minX + maxX)/2; const dx = Math.round(W/2 - groupCenter); platforms.forEach(p=> p.x += dx); spawnA.x += dx; spawnB.x += dx; return map; }); currentMap = Maps[0]; }
rebuildMapsAndCenter();

let Players = [], Bullets = [], Particles = [], AOEs = [];
function roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function spawnParticles(x,y,n,color){ for(let i=0;i<n;i++) Particles.push({ x,y, vx: rand(-3,3), vy: rand(-6,-1), life: randi(18,40), color }); }
function wrapText(ctx,text,maxW){ if(!text) return ['']; const words=text.split(' '); const lines=[]; let line=''; for(let i=0;i<words.length;i++){ const test=line+words[i]+' '; if(ctx.measureText(test).width>maxW && line.length>0){ lines.push(line.trim()); line = words[i]+' '; } else line = test; } if(line.length) lines.push(line.trim()); return lines; }
function blendTints(a,b){ if(!a) return Object.assign({}, b); if(!b) return Object.assign({}, a); const oa = (a.a||0), ob = (b.a||0); const w = oa+ob || 1; return { r: Math.round((a.r*oa + b.r*ob)/w), g: Math.round((a.g*oa + b.g*ob)/w), b: Math.round((a.b*oa + b.b*ob)/w), a: Math.min(0.9, oa+ob) }; }

function initStatus(){ return { poison: { stacks:0, time:0, source:null }, parasite: { stacks:0, time:0, source:null }, burn: { stacks:0, time:0, source:null }, slow: { stacks:0, time:0 }, stun: { time:0 }, silence: { time:0 }, shield: { value:0, time:0 } }; }
function applyPoisonTo(target, stacks, source){ target.status.poison.stacks += stacks; target.status.poison.time = Math.max(target.status.poison.time, 2000); target.status.poison.source = source; }
function applyParasiteTo(target, stacks, source){ target.status.parasite.stacks += stacks; target.status.parasite.time = Math.max(target.status.parasite.time, 2000); target.status.parasite.source = source; }
function applyBurnTo(target, stacks, source){ target.status.burn.stacks += stacks; target.status.burn.time = Math.max(target.status.burn.time, 3000); target.status.burn.source = source; }

class Player {
  constructor(id,x,y,color){
    this.id=id; this.x=x; this.y=y; this.w=56; this.h=56; this.vx=0; this.vy=0; this.color=color; this.baseColor=color;
    this.health=100; this.maxHealth=100; this.baseDamage=10; this.bulletSpeed=8; this.speed=4.0; this._baseSpeed=this.speed;
    this.maxMag=4; this.mag=4; this.reload=0; this.reloadTime = 1200;   // base 1.2 seconds (ms) this.fireCooldown=0; this.alive=true; this.status=initStatus(); this.tint=null;
    // rounds-style fields
    this.attackSpeed=1; this.moveSpeedMultiplier=1; this.bulletSpeedMultiplier=1; this.lifesteal=0; this.scavenger=0; this.tasteOfBlood_ms=0;
    this.hasGrow=false; this.growDamageMultiplier=1; this.timedDet=0; this.remote=false; this.trickster=false; this.onDealDamageHooks=[]; this.blockCooldown=0; this.blockCooldownMax=250; this.blockEffects={};
    this.poisonStacks=0; this.parasiteStacks=0; this.toxicCloud=false; this.explosive=0; this.bounce=0; this.pierce=0;
    // multishot features (disabled by default)
    this.multishotEnabled=false; this.bulletsPerShot=1; this.burstEnabled=false; this.burstCount=1; this.burstDelay=0; this.rapidFireEnabled=false; this.reloadOnHit=false;
    this.cards=[]; this.perks=[]; this.legFrame=1; this.legTime=0; this.facing=1; this.gunAngle=0; this.gunAngleTarget=0;
    this.blockReady=true; this.blocking=false; this.blockHeld=false; this.canRevive=false;
    this._growTimer=0; this._tasteOfBloodActive=false; this._brawler=false; this._demonicPact=false; this._homing=false; this._sneaky=false;
    // input locks for one-shot-per-click
    this.shootLock=false;
    // ammo property normalized name for clarity
    this.ammo = this.maxMag;
  }
  center(){ return { x: this.x + this.w/2, y: this.y + this.h/2 }; }
  applyCard(card){ if(card && card.name && typeof card.apply === 'function'){ try{ card.apply(this); this.cards.push(card.name); }catch(e){ console.error('card.apply error', e); } return; } if(typeof card === 'string'){ this.cards.push(card); if(card.toLowerCase().includes('poison')) this.poisonStacks++; if(card.toLowerCase().includes('parasite')) this.parasiteStacks++; } }
  respawnAt(pos){ this.x=pos.x; this.y=pos.y; this.vx=0; this.vy=0; this.health=this.maxHealth; this.mag=this.maxMag; this.alive=true; this.status=initStatus(); this.tint=null; this.ammo=this.maxMag; }
  takeDamage(amount, source){ if(!this.alive) return false; let dmg=Math.max(1, Math.round(amount - (this.status.shield.value || 0))); if(this._decay){ applyBurnTo(this,1,source); return { killed:false, revived:false }; } this.health -= dmg; if(this.health <= 0){ if(this.canRevive){ this.canRevive=false; this.maxHealth = Math.max(8, Math.round(this.maxHealth * 0.65)); this.health = Math.round(this.maxHealth * 0.45); this.tint={r:255,g:240,b:120,a:0.6}; Scheduler.schedule(900, ()=>{ if(this.tint) this.tint=null; }); return { killed:false, revived:true }; } else { this.alive=false; return { killed:true, revived:false }; } } return { killed:false, revived:false }; }
  _onDealDamage(amount){ if(this.lifesteal && this.lifesteal > 0){ this.health = Math.min(this.maxHealth, this.health + amount * this.lifesteal); } if(this.scavenger && this.scavenger > 0){ this.ammo = Math.min(this.maxMag, this.ammo + this.scavenger); } if(this._tasteOfBloodActive){ this.tasteOfBlood_ms = Math.max(this.tasteOfBlood_ms, 3000); this.moveSpeedMultiplier = Math.max(this.moveSpeedMultiplier, 1.5); } if(this._brawler){ const owner=this; const prevMax = owner._brawlerPrevMax || owner.maxHealth; owner._brawlerPrevMax = owner.maxHealth; owner.maxHealth = Math.round(owner.maxHealth * 3.0); owner.health = Math.min(owner.maxHealth, owner.health + 1); Scheduler.schedule(3000, ()=>{ owner.maxHealth = prevMax; owner.health = Math.min(owner.health, owner.maxHealth); }); } if(this.onDealDamageHooks) for(const fn of this.onDealDamageHooks) try{ fn(this, amount); }catch(e){ console.error(e); } }
  update(input, dt, opponent){ const dtSec = dt / 1000; const moving = Math.abs(this.vx) > 0.4; if(moving){ this.legTime += dt * 0.018; if(this.legTime > 1){ this.legFrame = (this.legFrame + 1) % 4; this.legTime = 0; } } else { this.legFrame = 1; this.legTime = 0; } const effectiveSpeed = (this._baseSpeed || this.speed) * (this.moveSpeedMultiplier || 1); if(input){ if(input.left) this.vx = -effectiveSpeed; else if(input.right) this.vx = effectiveSpeed; else this.vx *= 0.84; if(input.jump && this.onGround){
        this.vy = -13; // MUCH HIGHER JUMP
        this.onGround = false;
      } } else { this.vx *= 0.90; } this.vy += currentMap.gravity || 0.45; this.x += this.vx; this.y += this.vy; this.onGround = false; for(const plat of currentMap.platforms){ if(this.x + this.w > plat.x && this.x < plat.x + plat.w){ const feet = this.y + this.h; if(feet >= plat.y && feet - this.vy <= plat.y + 12){ this.y = plat.y - this.h; this.vy = 0; this.onGround = true; } } } if(currentMap.lavaY && this.y + this.h > currentMap.lavaY){ if(!this._lavaCooldown || performance.now() - this._lavaCooldown > 300){ this._lavaCooldown = performance.now(); this.health -= 10; this.vy = -18; spawnParticles(this.center().x, this.center().y, 12, '#ff6a3c'); this.tint = { r:255, g:120, b:60, a:0.45 }; Scheduler.schedule(450, ()=>{ if(this.tint && this.status.poison.time <= 0 && this.status.parasite.time <= 0) this.tint = null; }); } this.y = Math.min(this.y, currentMap.lavaY - this.h - 1); } if(opponent){ const my = this.center(); const op = opponent.center(); const dx = op.x - my.x; const dy = op.y - my.y; this.gunAngleTarget = Math.atan2(dy, dx); const diff = (this.gunAngleTarget - this.gunAngle); const a = ((diff + Math.PI) % (Math.PI*2)) - Math.PI; this.gunAngle = this.gunAngle + a * clamp(0.08 * dtSec * 60, 0, 1); this.facing = Math.cos(this.gunAngle) >= 0 ? 1 : -1; } if(this.status.poison.time > 0){ this.status.poison.time -= dt; const stacks = this.status.poison.stacks; const dmgPerSec = 5 * stacks; const dmg = dmgPerSec * dtSec; this.health -= dmg; this.tint = blendTints(this.tint, { r:0, g:200, b:50, a:0.32 }); if(this.status.poison.time <= 0){ this.status.poison.stacks = 0; this.status.poison.source = null; } } if(this.status.parasite.time > 0){ this.status.parasite.time -= dt; const stacks = this.status.parasite.stacks; const dmgPerSec = 5 * stacks; const dmg = dmgPerSec * dtSec; this.health -= dmg; const attacker = this.status.parasite.source; if(attacker && attacker.alive){ const heal = dmg * 0.5; attacker.health = Math.min(attacker.maxHealth, attacker.health + heal); } this.tint = blendTints(this.tint, { r:160, g:0, b:200, a:0.42 }); if(this.status.parasite.time <= 0){ this.status.parasite.stacks = 0; this.status.parasite.source = null; } } if(this.status.burn.time > 0){ this.status.burn.time -= dt; const stacks = this.status.burn.stacks; const dmgPerSec = 4 * stacks; const dmg = dmgPerSec * dtSec; this.health -= dmg; this.tint = blendTints(this.tint, { r:220, g:80, b:0, a:0.32 }); if(this.status.burn.time <= 0){ this.status.burn.stacks = 0; this.status.burn.source = null; } } if(this.status.slow.time > 0){ this.status.slow.time -= dt; if(this.status.slow.time <= 0) this.status.slow.stacks = 0; } if(this.tasteOfBlood_ms > 0){ this.tasteOfBlood_ms = Math.max(0, this.tasteOfBlood_ms - dt); if(this.tasteOfBlood_ms <= 0) this.moveSpeedMultiplier = 1; } if(this.reload > 0){ this.reload -= dt; if(this.reload <= 0){ this.reload = 0; this.ammo = this.maxMag; } } if(this.hasGrow){ this._growTimer = (this._growTimer || 0) + dt; while(this._growTimer >= 10){ this.growDamageMultiplier = (this.growDamageMultiplier || 1) * 1.01; this._growTimer -= 10; } } // --- Pristine Perseverence: +400% Max HP when above 90% ---
if (this._pristine) {
    // store original base max once
    if (!this._pristineBaseMax) {
        this._pristineBaseMax = this.maxHealth;
    }
    const _pr_base = this._pristineBaseMax;
    const _pr_above90 = this.health >= _pr_base * 0.9;
    if (_pr_above90 && !this._pristineBoostActive) {
        // activate boost: total 500% of base (base * 5)
        this._pristineBoostActive = true;
        this.maxHealth = Math.round(_pr_base * 5.0);
        // scale current health proportionally (give the benefit)
        this.health = Math.min(this.maxHealth, Math.round(this.health * 5.0));
    } else if (!_pr_above90 && this._pristineBoostActive) {
        // remove boost and scale health back proportionally
        const ratio = this.health / this.maxHealth;
        this.maxHealth = _pr_base;
        this.health = Math.min(this.maxHealth, Math.round(this.maxHealth * ratio));
        this._pristineBoostActive = false;
    }
}
if(this.health <= 0) this.alive = false; }
  draw(ctx){ if(!this.status) this.status = initStatus();
// --- Reload Circle ---
if(this.reload>0){ const pct=1-(this.reload/this.reloadTime); const cx=this.x+this.w/2, cy=this.y+this.h+20; const r=14; const start=-Math.PI/2, end=start+pct*Math.PI*2; ctx.save(); ctx.lineWidth=4; ctx.strokeStyle='#ffd966'; ctx.beginPath(); ctx.arc(cx,cy,r,start,end); ctx.stroke(); ctx.restore(); }
 this.drawLegs(ctx); ctx.save(); ctx.translate(this.x + this.w/2, this.y + this.h/2); ctx.beginPath(); ctx.fillStyle = this.baseColor; ctx.ellipse(0,0,this.w/2,this.h/2,0,0,Math.PI*2); ctx.fill(); if(this.tint){ ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(${this.tint.r},${this.tint.g},${this.tint.b},${this.tint.a})`; ctx.beginPath(); ctx.ellipse(0,0,this.w/2,this.h/2,0,0,Math.PI*2); ctx.fill(); ctx.globalCompositeOperation = 'source-over'; } ctx.fillStyle = '#111'; ctx.beginPath(); ctx.ellipse(-8,-8,4,4,0,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.ellipse(8,-8,4,4,0,0,Math.PI*2); ctx.fill(); ctx.fillStyle = '#321'; ctx.fillRect(-10, 10, 20, 4); ctx.save(); ctx.rotate(this.gunAngle); ctx.fillStyle = '#222'; ctx.fillRect(20, -6, 46, 12); ctx.fillStyle = '#333'; ctx.fillRect(66, -3, 12, 6); ctx.restore(); ctx.restore(); const hpW = this.w, hpX = this.x + (this.w - hpW)/2, hpY = this.y - 16; ctx.fillStyle = 'rgba(0,0,0,0.45)'; roundRect(ctx, hpX-2, hpY-2, hpW+4, 12, 6); ctx.fill(); ctx.fillStyle = '#600'; roundRect(ctx, hpX, hpY, hpW, 8, 4); ctx.fill(); ctx.fillStyle = '#3bd34a'; roundRect(ctx, hpX, hpY, hpW * clamp(this.health/this.maxHealth, 0, 1), 8, 4); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = '12px monospace'; ctx.fillText(`${Math.round(Math.max(0,this.ammo))}/${this.maxMag}`, this.x + 6, this.y + this.h + 18); if(this.status.poison.stacks > 0){ ctx.fillStyle = '#a8ff9a'; ctx.font = '12px Inter, Arial'; ctx.fillText(`🟢 POISON ×${this.status.poison.stacks}`, this.x, this.y - 30); } if(this.status.parasite.stacks > 0){ ctx.fillStyle = '#e0b3ff'; ctx.font = '12px Inter, Arial'; ctx.fillText(`🟣 PARASITE ×${this.status.parasite.stacks}`, this.x, this.y - 46); } }
  drawLegs(ctx){ const cx = this.x + this.w/2, cy = this.y + this.h/2 + 18; const f = this.legFrame; const frames = [ {lAng:-0.35,rAng:0.35,spread:12},{lAng:0.0,rAng:0.0,spread:6},{lAng:0.35,rAng:-0.35,spread:12},{lAng:0.0,rAng:0.0,spread:6} ]; const frm = frames[f]; ctx.save(); ctx.translate(cx, cy); ctx.rotate(frm.lAng); ctx.beginPath(); ctx.ellipse(-6, 6, 8, 18, 0, 0, Math.PI*2); ctx.fillStyle = '#2b2b2b'; ctx.fill(); ctx.restore(); ctx.save(); ctx.translate(cx, cy); ctx.rotate(frm.rAng); ctx.beginPath(); ctx.ellipse(6, 6, 8, 18, 0, 0, Math.PI*2); ctx.fillStyle = '#2b2b2b'; ctx.fill(); ctx.restore(); }
}


class Bullet {
  constructor(x,y,vx,vy,owner,opts={}){
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.owner = owner || null;
    this.r = opts.r || 6;
    this.baseR = this.r;
    this.damage = (opts.damage !== undefined) ? opts.damage : (owner ? owner.baseDamage : 6);
    this.life = opts.life || 240; // frames
    this.bounces = 0;
    this.maxBounces = (owner && owner.bounce) || 0;
    this.pierces = (owner && owner.pierce) || 0;
    this.explosive = (owner && owner.explosive) || 0;
    this.spawnTime = performance.now();
    this.trail = [];
    this.timedDet = (owner && owner.timedDet) || 0;
    this.homing = (owner && owner._homing) || false;
    this.remote = (owner && owner.remote) || false;
    this.trickster = (owner && owner.trickster) || false;
    this.thruster = (owner && owner._thruster) || false;
    this.sneaky = (owner && owner._sneaky) || false;
    this.growMultiplier = (owner && owner.growDamageMultiplier) || 1;
    // clamp some values
    this.vx = Number(this.vx) || 0;
    this.vy = Number(this.vy) || 0;
  }

  update(){
    // lifespan
    this.life--;

    // GROW REWORK — bullet visually grows and gains damage every second
    if (this.owner && this.owner.hasGrow) {
        const ageSec = (performance.now() - this.spawnTime) / 1000;
        const ticks = Math.floor(ageSec);
        const base = (this.owner && this.owner.baseDamage) || this.damage;
        const dmgFactor = Math.pow(1.10, ticks);
        this.damage = Math.max(1, Math.round(base * dmgFactor));
        const sizeFactor = Math.pow(1.05, ticks);
        this.r = Math.max(2, this.baseR * sizeFactor);
    } else {
        this.r = this.baseR;
    }

    // homing behaviour (weak, smooth steering)
    if(this.homing){
      let target = null;
      let best = 999999;
      for(const p of Players){
        if(!p.alive) continue;
        if(p === this.owner) continue;
        const d = Math.hypot(p.center().x - this.x, p.center().y - this.y);
        if(d < best){ best = d; target = p; }
      }
      if(target){
        const dx = target.center().x - this.x;
        const dy = target.center().y - this.y;
        const ang = Math.atan2(dy, dx);
        const speed = Math.max(0.001, Math.hypot(this.vx, this.vy));
        // steer slightly toward target
        const steer = 0.08;
        const desiredVx = Math.cos(ang) * speed;
        const desiredVy = Math.sin(ang) * speed;
        this.vx += (desiredVx - this.vx) * steer;
        this.vy += (desiredVy - this.vy) * steer;
      }
    }

    // apply gravity (unless sneaky or remote)
    if(!this.sneaky && !this.remote){
      this.vy += (currentMap.gravity || 0.45) * 0.05; // reduced gravity for floatier bullets
    }

    // movement + trail
    this.x += this.vx;
    this.y += this.vy;
    this.trail.push({ x: this.x, y: this.y, r: this.r, t: performance.now() });
    if(this.trail.length > 12) this.trail.shift();

    // simple boundary life kill
    if(this.x < -400 || this.x > W + 400 || this.y > H + 600) this.life = 0;
  }

  draw(ctx){
    // trail
    for(let i=0;i<this.trail.length;i++){
      const t = this.trail[i];
      const alpha = (i+1) / this.trail.length * 0.35;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(t.x, t.y, Math.max(1, t.r * 0.9), 0, Math.PI*2);
      ctx.fillStyle = this.owner ? this.owner.baseColor : '#fff';
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // main bullet
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI*2);
    ctx.fillStyle = this.owner ? this.owner.baseColor : '#fff';
    ctx.fill();

    // outline
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // optional glow if trickster or explosive
    if(this.trickster || this.explosive){
      ctx.globalAlpha = 0.12;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * 1.9, 0, Math.PI*2);
      ctx.fillStyle = '#ffd27a';
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}


class AOE { constructor(x,y,r,ttl,type,meta={}){ this.x=x; this.y=y; this.r=r; this.ttl=ttl; this.type=type; this.meta=meta; this.created=performance.now(); } update(){ return (performance.now() - this.created) < this.ttl; } draw(ctx){ if(this.type === 'toxic'){ ctx.globalAlpha=0.16; ctx.fillStyle='#3aa84a'; ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1; } else if(this.type === 'explosion'){ ctx.globalAlpha=0.16; ctx.fillStyle='#ffd27a'; ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1; } else if(this.type === 'emp'){ ctx.globalAlpha=0.12; ctx.fillStyle='#9be7ff'; ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1; } else if(this.type === 'saw'){ ctx.globalAlpha=0.18; ctx.fillStyle='#d6b5ff'; ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1; } else if(this.type==='radiance'){ ctx.globalAlpha=0.16; ctx.fillStyle='#ffd27a'; ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1; } else { ctx.globalAlpha=0.12; ctx.fillStyle='#8ad0ff'; ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1; } } }


class Bomb {
    constructor(x, y, damage, owner) {
        this.x = x;
        this.y = y;
        this.damage = damage;
        this.owner = owner;
        this.created = performance.now();
        this.r = 14;
    }
    update() {
        if (performance.now() - this.created >= 500) {
            createExplosion(this.x, this.y, this.damage, 60, this.owner);
            return false;
        }
        return true;
    }
    draw(ctx) {
        ctx.fillStyle = "#ffdd66";
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}

let Bombs = [];

// ⭐ Timed detonation helper: consistently spawn Bombs when bullets meet conditions
function spawnTimedBomb(bullet){
    try{
        if(!bullet) return;
        // only spawn if the owner has timedDet flag (mirrors previous logic)
        const owner = bullet.owner || null;
        if(!owner || !owner.timedDet) return;
        // create bomb at bullet position (matches Bomb constructor usage)
        Bombs.push(new Bomb(Math.round(bullet.x), Math.round(bullet.y), bullet.damage, owner));
    }catch(e){ console.error('spawnTimedBomb error', e); }
}


/* --------------------- Explosions & clouds --------------------- */
function createExplosion(x,y,damage,baseRadius=60,owner=null){ const radius = Math.max(20, Math.round(baseRadius * (1 + damage / 100))); AOEs.push(new AOE(x,y,radius, Math.round((0.25 + (damage/300))*1000), 'explosion', { damage, owner })); spawnParticles(x,y, Math.min(160, Math.round(radius/2)), '#ffb07a'); for(const p of Players){ const d=Math.hypot(p.center().x - x, p.center().y - y); if(d <= radius + p.w*0.5){ const dmg = Math.max(1, Math.round(damage * (1 - (d / Math.max(1, radius))))); p.health -= dmg; const dirx = (p.center().x - x) / Math.max(1,d); const diry = (p.center().y - y) / Math.max(1,d); p.vx += dirx * (radius * 0.06); p.vy += diry * (radius * 0.04); } } }
function createToxicCloud(x,y,damage,owner){ const base=70; const radius = Math.max(30, Math.round(base * (1 + damage / 100))); AOEs.push(new AOE(x,y,radius,5000,'toxic',{damage,owner})); }

/* --------------------- Damage routing --------------------- */
function applyDamageToTarget(target, rawDmg, owner){ if(!target) return; if(owner && owner._decay){ applyBurnTo(target,1,owner); try{ owner._onDealDamage && owner._onDealDamage(1); }catch(e){} return; } if(typeof target.takeDamage === 'function'){ target.takeDamage(rawDmg, owner); } else { target.health -= rawDmg; } try{ owner && owner._onDealDamage && owner._onDealDamage(rawDmg); }catch(e){ console.error(e); } }

/* --------------------- bullet collision (extended) --------------------- */
function bulletCollisionLogic(b){ if(b.y > H + 400) return true; for(const p of currentMap.platforms){ if(b.x > p.x && b.x < p.x + p.w && b.y > p.y && b.y < p.y + p.h + 12){ if(b.bounces < b.maxBounces){ b.vy *= -0.45; b.vx *= 0.8; b.bounces++; // ⭐ Bomb on bounce (timed det) ⭐
try{ spawnTimedBomb(b); }catch(e){}
if(b.trickster) b.damage = Math.round(b.damage * 1.8); return false; } else { if(b.explosive) createExplosion(b.x,b.y,b.damage,60,b.owner); if(b.timedDet) Scheduler.schedule(420, ()=> createExplosion(b.x,b.y,b.damage,60,b.owner)); if(b.owner && b.owner.toxicCloud) createToxicCloud(b.x,b.y,b.damage,b.owner); return true; } } } for(const p of Players){ if(p !== b.owner && p.alive){ const d = Math.hypot(b.x - p.center().x, b.y - p.center().y); if(d < b.r + Math.max(p.w,p.h)/2 * 0.48){ const dmg = Math.round(b.damage); if(b.owner && b.owner.poisonStacks) applyPoisonTo(p, b.owner.poisonStacks, b.owner); if(b.owner && b.owner.parasiteStacks) applyParasiteTo(p, b.owner.parasiteStacks, b.owner); applyDamageToTarget(p, dmg, b.owner);
            // ⭐ Bomb when hitting a player ⭐
try{ spawnTimedBomb(b); }catch(e){}
// DAZZLE: stacked stun (0.5s per Dazzle card) + particle burst
            if (b.owner && b.owner._dazzle) {
                try {
                    const dazzleCount = (b.owner.cards && b.owner.cards.filter(c => c === 'Dazzle').length) || 1;
                    const stunTime = dazzleCount * 500; // milliseconds
                    p.status.stun.time = Math.max(p.status.stun.time || 0, stunTime);
                } catch (e) { /* ignore */ }
                // particles: purple flash and white sparks
                try {
                    spawnParticles(b.x, b.y, 10, 'rgba(180,0,255,0.95)');
                    spawnParticles(b.x, b.y, 6, '#ffffff');
                } catch (e) {}
            }
    if(b.thruster){ const dirx=(p.center().x-b.x)/Math.max(1,d); const diry=(p.center().y-b.y)/Math.max(1,d); p.vx += dirx * 2.2; p.vy += diry * 1.6; } if(b.explosive) createExplosion(b.x,b.y,b.damage,60,b.owner); if(b.owner && b.owner.toxicCloud) createToxicCloud(b.x,b.y,b.damage,b.owner); if(b.pierces>0) b.pierces--; else return true; } } } if(b.life <= 0){ try{ spawnTimedBomb(b); }catch(e){} return true; } return false; }

/* --------------------- Card Pool --------------------- */
const CardPool = [
  { name:'Barrage', desc:'Fire many bullets at once. (+5 bullets/shot) -70% dmg', apply(p){ p.multishotEnabled=true; p.bulletsPerShot=(p.bulletsPerShot||1)+5; p.baseDamage = Math.round((p.baseDamage||10)*0.30); p.maxMag += 5; p.ammo = p.maxMag; } },
  { name:'Buckshot', desc:'Shotgun style shot (+6 pellets) -60% dmg', apply(p){ p.multishotEnabled=true; p.bulletsPerShot=(p.bulletsPerShot||1)+6; p.baseDamage = Math.round((p.baseDamage||10)*0.4); p.spread = (p.spread||0)+0.25; } },
  { name:'Burst', desc:'3-round burst (-60% dmg)', apply(p){ p.burstEnabled=true; p.burstCount=3; p.burstDelay=60; p.baseDamage = Math.round((p.baseDamage||10)*0.4); } },
  { name:'Spray', desc:'High firerate (+12 ammo, -75% dmg)', apply(p){ p.rapidFireEnabled=true; p.attackSpeed = (p.attackSpeed||1)*10; p.maxMag += 12; p.ammo = p.maxMag; p.baseDamage = Math.round((p.baseDamage||10)*0.25); } },
  { name:'Scavenger', desc:'Dealing damage reloads your weapon (restore ammo on hit)', apply(p){ p.reloadOnHit = true; p.scavenger = 1; } },

  { name:'Big bullets', desc:'Bigger bullets (slight damage up)', apply(p){ p.baseDamage = Math.round((p.baseDamage||10)*1.12); } },
  { name:'Bombs Away', desc:'Spawn bombs around you when specific condition triggers', apply(p){ p._bombsAway = true; p.maxHealth = Math.round((p.maxHealth||100) * 1.15); p.ammo = p.maxMag; } },
  { name:'Bouncy', desc:'+2 bounces; +25% damage', apply(p){ p.bounce = (p.bounce||0)+2; p.baseDamage = Math.round((p.baseDamage||10)*1.25); } },
  { name:'Brawler', desc:'+200% HP 3s after hitting', apply(p){ p._brawler=true; } },
  { name:'Careful Planning', desc:'+100% damage; -150% atkspd', apply(p){ p.baseDamage = Math.round((p.baseDamage||10)*2); p.attackSpeed *= 0.4; } },
  { name:'Chase', desc:'+60% move toward opponent; +30% HP', apply(p){ p.moveSpeedMultiplier = Math.max(p.moveSpeedMultiplier,1.0); p.maxHealth = Math.round(p.maxHealth * 1.3); p.health = Math.min(p.maxHealth, p.health); p._chase = true; } },
  { name:'Chilling Presence', desc:'Slow nearby enemies; +25% HP', apply(p){ p.maxHealth = Math.round(p.maxHealth * 1.25); p.health = Math.min(p.maxHealth, p.health); p._chillPresence = true; } },
  { name:'Cold Bullets', desc:'+70% slow on hit', apply(p){ p._coldBullets = true; } },
  { name:'Combine', desc:'+100% dmg; -2 ammo', apply(p){ p.baseDamage = Math.round((p.baseDamage||10)*2); p.maxMag = Math.max(1, (p.maxMag||4)-2); p.ammo = Math.min(p.ammo, p.maxMag); } },
  { name:'Dazzle', desc:'Bullets stun enemies on hit', apply(p){ p._dazzle=true; } },
  { name:'Decay', desc:'Damage to you is dealt over 4s; +50% HP', apply(p){ p._decay=true; p.maxHealth = Math.round(p.maxHealth * 1.5); p.health = Math.min(p.maxHealth, p.health); } },
  { name:'Defender', desc:'More HP and little cooldown shaves (non-block variant)', apply(p){ p.maxHealth = Math.round(p.maxHealth * 1.3); p.health = Math.min(p.health, p.maxHealth); } },
  { name:'Demonic Pact', desc:'Shooting costs HP; removes shooting cooldown; more ammo', apply(p){ p._demonicPact=true; p.maxMag = (p.maxMag||4)+9; p.ammo = p.maxMag; } },
  { name:'Drill Ammo', desc:'Bullets pierce more targets', apply(p){ p.pierce = (p.pierce||0)+7; } },
  { name:'Dazzle', desc:'Bullets stun the opponent multiple times', apply(p){ p._dazzle=true; } },
  { name:'Glass Cannon', desc:'+100% dmg; -90% HP', apply(p){ p.baseDamage = Math.round((p.baseDamage||10)*2); p.maxHealth = Math.max(6, Math.round(p.maxHealth * 0.1)); p.health = Math.min(p.health, p.maxHealth); } },
  { name:'Grow', desc:'Bullets gain damage over travel', apply(p){ p.hasGrow=true; } },
  { name:'Homing', desc:'Bullets home toward targets; -25% dmg', apply(p){ p._homing=true; p.baseDamage = Math.round((p.baseDamage||10)*0.75); } },
  { name:'Huge', desc:'+80% HP', apply(p){ p.maxHealth = Math.round(p.maxHealth * 1.8); p.health = Math.min(p.health, p.maxHealth); } },
  { name:'Leech', desc:'+75% lifesteal; +30% HP', apply(p){ p.lifesteal = Math.max(p.lifesteal, 0.75); p.maxHealth = Math.round(p.maxHealth * 1.3); p.health = Math.min(p.health, p.maxHealth); } },
  { name:'Lifestealer', desc:'Heal by proximity to enemy; +25% HP', apply(p){ p._lifestealer=true; p.maxHealth = Math.round(p.maxHealth * 1.25); p.health = Math.min(p.health, p.maxHealth); } },
  { name:'Mayhem', desc:'+5 bounces; -15% dmg', apply(p){ p.bounce = (p.bounce||0) + 5; p.baseDamage = Math.round((p.baseDamage||10)*0.85); } },
  { name:'Parasite', desc:'Parasite shots heal you (50% of DoT)', apply(p){ p.parasiteStacks = (p.parasiteStacks||0) + 1; } },
  { name:'Phoenix', desc:'Respawn once on death (one-time)', apply(p){ p.canRevive=true; p.maxHealth = Math.round(p.maxHealth * 0.65); p.health = Math.min(p.health, p.maxHealth); } },
  { name:'Poison', desc:'Poison shots (stacking)', apply(p){ p.poisonStacks = (p.poisonStacks||0) + 1; } },
  { name:'Pristine Perseverence', desc:'+400% HP when above 90% HP', apply(p){ p._pristine=true; } },
  { name:'Quick Reload', desc:'-70% reload time', apply(p){ p.reloadTime = Math.max(8, Math.round((p.reloadTime||70) * 0.30)); } },
  { name:'Quick Shot', desc:'+150% bullet speed', apply(p){ p.bulletSpeed = (p.bulletSpeed||8) * 2.5; p.reloadTime += 250; } },
  { name:'Steady Shot', desc:'+40% HP; +100% bullet speed', apply(p){ p.maxHealth = Math.round(p.maxHealth * 1.4); p.bulletSpeed = (p.bulletSpeed||8) * 2.0; } },
  { name:'Tank', desc:'+100% HP; -25% ATKSPD', apply(p){ p.maxHealth = Math.round(p.maxHealth * 2.0); p.attackSpeed *= 0.75; } },
  { name:'Target Bounce', desc:'+1 bounce; bullets aim for visible targets when bouncing', apply(p){ p.targetBounce = true; p.bounce = (p.bounce||0) + 1; p.baseDamage = Math.round((p.baseDamage||10) * 0.8); } },
  { name:'Taste of Blood', desc:'+50% movement speed for 3s after dealing damage; +30% lifesteal', apply(p){ p._tasteOfBloodActive = true; p.lifesteal = Math.max(p.lifesteal, 0.30); } },
  { name:'Thruster', desc:'Bullets push targets on hit', apply(p){ p._thruster = true; } },
  { name:'Timed Detonation', desc:'Bullets spawn bombs after 0.5s', apply(p){ p.timedDet = 1; p.baseDamage = Math.round((p.baseDamage||10) * 0.85); } },
  { name:'Toxic Cloud', desc:'Bullets spawn poison cloud on impact', apply(p){ p.toxicCloud = true; p.attackSpeed *= 0.8; } },
  { name:'Trickster', desc:'+2 bounces; damage buff per bounce', apply(p){ p.trickster = true; p.bounce = (p.bounce||0) + 2; p.baseDamage = Math.round((p.baseDamage||10) * 0.8); } },
  { name:'Wind Up', desc:'+100% bullet speed; +60% damage; heavy attack penalty', apply(p){ p.bulletSpeed = (p.bulletSpeed||8) * 2.0; p.baseDamage = Math.round((p.baseDamage||10) * 1.6); p.attackSpeed *= 0.5; } }
];

/* --------------------- Pick system (always 5 options) --------------------- */
function pickCards(n){ const pool = CardPool.slice(); const picks = []; while(picks.length < n && pool.length > 0){ const idx = randi(0, pool.length-1); picks.push(pool.splice(idx,1)[0]); } return picks; }
let awaitingPicks = []; let pickState = { active:false, currentPicker:null, options:[], chosen:null };
function showNextPick(){ if(awaitingPicks.length === 0){ pickState.active=false; startRound(); return; } pickState.currentPicker = awaitingPicks.shift(); pickState.options = pickCards(5); pickState.active = true; }

/* --------------------- Round lifecycle --------------------- */
let started=false, showSplash=true, inRound=false, roundNumber=1; let scores={p1:0,p2:0}, TARGET_SCORE=5;
function startRound(){ currentMap = Maps[randi(0,Maps.length-1)]; Players[0].respawnAt(currentMap.spawnA); Players[1].respawnAt(currentMap.spawnB); Players.forEach(p=>{ p.health=p.maxHealth; p.ammo=p.maxMag; p.alive=true; p.status=initStatus(); p.tint=null; }); Bullets=[]; Particles=[]; AOEs=[]; inRound=true; }


function endRound(winner) {
    inRound = false;

    // increment score for winner
    if (winner === Players[0]) scores.p1++;
    else scores.p2++;

    roundNumber++;

    // If someone reached target -> full match reset (Option A)
    if (scores.p1 >= TARGET_SCORE || scores.p2 >= TARGET_SCORE) {

        showSplash = true;
        started = false;

        setTimeout(() => {
            // Reset scoreboard and round counter
            scores = { p1: 0, p2: 0 }

;
            roundNumber = 1;

            for (let i = 0; i < Players.length; i++) {

                const old = Players[i];

                const spawn = (i === 0) ? currentMap.spawnA : currentMap.spawnB;
                const baseColor = old.baseColor;

                const fresh = new Player(
                    old.id,
                    spawn.x,
                    spawn.y,
                    baseColor
                );

                Object.assign(old, fresh);

                old.cards = [];
            }

        }, 1200);

        return;
    }

    const winnerId = (winner === Players[0]) ? "p1" : "p2";
    const loserId = (winnerId === "p1") ? "p2" : "p1";

    awaitingPicks = [winnerId, loserId];
    pickState.active = false;

    setTimeout(() => showNextPick(), 420);
}


/* --------------------- Shooting system  --------------------- */
function fireSingleBullet(player, angleOffset=0){ if(!player || !player.alive) return; const GUN_LENGTH = 50;
  const muzzleX = player.center().x + Math.cos(player.gunAngle + angleOffset) * GUN_LENGTH; const muzzleY = player.center().y + Math.sin(player.gunAngle + angleOffset) * GUN_LENGTH; const speed = (player.bulletSpeed || 8) * (player.bulletSpeedMultiplier || 1); const vx = Math.cos(player.gunAngle + angleOffset) * speed * (0.96 + Math.random()*0.08); const vy = Math.sin(player.gunAngle + angleOffset) * speed * (0.96 + Math.random()*0.08); const damage = Math.max(1, Math.round((player.baseDamage || 6) * (player.growDamageMultiplier || 1))); const b = new Bullet(muzzleX + rand(-3,3), muzzleY + rand(-3,3), vx, vy, player, { damage });
  if (player.timedDet) Bombs.push(new Bomb(muzzleX, muzzleY, b.damage, player)); b.explosive = player.explosive || 0; b.timedDet = player.timedDet || 0; b.homing = player._homing || false; b.remote = player.remote || false; b.growMultiplier = player.growDamageMultiplier || 1; b.trickster = player.trickster || false; b.thruster = player._thruster || false; b.sneaky = player._sneaky || false; Bullets.push(b); }

function tryFire(player){
  if(!player || !player.alive) return;
  if(player.reload > 0) return;

  // ⭐ Attack Speed throttle ⭐
  try{
    const now = performance.now();
    const key = player.id || 'p'+(player.id?player.id:'');
    const baseDelay = 220; // ms base delay between shots
    const fireDelay = baseDelay / (player.attackSpeed || 1);
    if(nextFireTime[key] && now < nextFireTime[key]) return;
    nextFireTime[key] = now + fireDelay;
  }catch(e){ /* defensive */ }
 // reloading
  // determine bullets required for this shot
  let bulletsNeeded = 1;
  if(player.multishotEnabled && player.bulletsPerShot > 1){ bulletsNeeded = player.bulletsPerShot; }
  else if(player.burstEnabled && player.burstCount > 1){ bulletsNeeded = player.burstCount; }
  else { bulletsNeeded = 1; }
  // check ammo
  // if not enough ammo for burst, fallback to 1 bullet
  if(player.ammo < bulletsNeeded){
    if(player.ammo >= 1){ bulletsNeeded = 1; }
    else return;
  }
  // consume ammo up front
  player.ammo -= bulletsNeeded;
  // fire according to type
  if(player.multishotEnabled && player.bulletsPerShot > 1){ const spread = player.spread || 0.28; const n = player.bulletsPerShot; for(let i=0;i<n;i++){ const offset = ((i - (n-1)/2) / Math.max(1,(n-1))) * spread; fireSingleBullet(player, offset); } } else if(player.burstEnabled && player.burstCount > 1){ for(let i=0;i<player.burstCount;i++){ Scheduler.schedule(i * player.burstDelay, ()=> fireSingleBullet(player) ); } } else { // single-shot or rapid-fire single bullet per click
    fireSingleBullet(player); }
  // reload behavior: if mag-based reload present, keep old reload; here keep player's reload timer minimal
  if(player.ammo <= 0){ player.reload = Math.max(1, Math.round(player.reloadTime)); }
}

/* --------------------- Input handling for firing --------------------- */
document.addEventListener('keydown', e=>{ if(!keys[e.key]) keyPress[e.key]=true; keys[e.key]=true; if(e.key==='Tab') e.preventDefault(); if(pickState && pickState.active && ['1','2','3','4','5'].includes(e.key)){ const idx=parseInt(e.key)-1; const player = pickState.currentPicker==='p1' ? Players[0] : Players[1]; if(pickState.options[idx]){ player.applyCard(pickState.options[idx]); pickState.active=false; pickState.chosen=pickState.options[idx]; setTimeout(()=> showNextPick(),220); } } });
document.addEventListener('keyup', e=>{ keys[e.key]=false; });
canvas.addEventListener('mousemove', e=>{ const rect = canvas.getBoundingClientRect(); mouse.x = e.clientX - rect.left; mouse.y = e.clientY - rect.top; });
canvas.addEventListener('mousedown', e=>{ mouse.down=true; if(showSplash) startSequence(); if(pickState && pickState.active){ const rect = canvas.getBoundingClientRect(); const mx = e.clientX - rect.left, my = e.clientY - rect.top; const boxW=Math.min(W*0.92,960), boxH=Math.min(H*0.78,360); const bx=(W-boxW)/2, by=(H-boxH)/2; const cardW=(boxW-80)/5, cardH=boxH-100; for(let i=0;i<pickState.options.length;i++){ const cx=bx + 40 + i*cardW, cy=by + 60; if(mx>=cx && mx<=cx+cardW && my>=cy && my<=cy+cardH){ const player = pickState.currentPicker==='p1' ? Players[0] : Players[1]; player.applyCard(pickState.options[i]); pickState.active=false; pickState.chosen=pickState.options[i]; spawnParticles(mx,my,20,'#ffd27a'); setTimeout(()=> showNextPick(),280); break; } } } });
canvas.addEventListener('mouseup', e=>{ mouse.down=false; });
function startSequence(){ started=true; showSplash=false; awaitingPicks=['p1','p2']; pickState.active=false; setTimeout(()=> showNextPick(),120); }

/* --------------------- Init & main loop --------------------- */
function init(){ Players = [ new Player('p1', Maps[0].spawnA.x, Maps[0].spawnA.y, '#e74c3c'), new Player('p2', Maps[0].spawnB.x, Maps[0].spawnB.y, '#3498db') ]; requestAnimationFrame(tick); }
init();
function tick(now){ const dt = Math.min(40, now - lastTime); lastTime = now; frames++; fpsTimer += dt; if(fpsTimer >= 1000){ fps = frames; frames = 0; fpsTimer = 0; } Scheduler.update(); const p1input = { left: keys['a'], right: keys['d'], jump: keys['w'], shoot: keys['t'], block: keys['Shift'] || keys['ShiftLeft'] }; const p2input = { left: keys['ArrowLeft'], right: keys['ArrowRight'], jump: keys['ArrowUp'], shoot: keys['l'], block: keys['Control'] || keys['ControlLeft'] }; if(pickState.active){ Players.forEach((p,i)=> p.update(null, dt, i===0?Players[1]:Players[0])); } else if(inRound){ Players.forEach((p,i)=> p.update(i===0? p1input : p2input, dt, i===0?Players[1]:Players[0])); // firing inputs - enforce one-shot-per-click unless cards present
    // Player 1 shoot key (t)
    if(keyPress['t']){ const p = Players[0]; // detect if player has multishot/rapid/burst and allow multiple bullets to be fired by tryFire
      tryFire(p); keyPress['t'] = false; }
    // Player 2 shoot key (l)
    if(keyPress['l']){ const p = Players[1]; tryFire(p); keyPress['l'] = false; }
    // bullets update & collisions
    for(let i=Bullets.length-1;i>=0;i--){ const b=Bullets[i]; b.update(); const remove = bulletCollisionLogic(b); if(remove) Bullets.splice(i,1); } // AOEs update
    for(let i=AOEs.length-1;i>=0;i--){ const a=AOEs[i]; if(!a.update()) AOEs.splice(i,1); else { if(a.type==='toxic'){ for(const p of Players){ const d=Math.hypot(p.center().x - a.x, p.center().y - a.y); if(d <= a.r){ const owner = a.meta.owner; if(owner && owner.poisonStacks) applyPoisonTo(p, owner.poisonStacks, owner); } } } else if(a.type==='emp'){ for(const p of Players){ const d=Math.hypot(p.center().x - a.x, p.center().y - a.y); if(d <= a.r){ p.status.slow.stacks = Math.max(p.status.slow.stacks || 0, 1); p.status.slow.time = 800; } } } else if(a.type==='saw'){ for(const p of Players){ const d=Math.hypot(p.center().x - a.x, p.center().y - a.y); if(d <= a.r){ p.health -= 0.6; } } } else if(a.type==='radiance'){ for(const p of Players){ const d=Math.hypot(p.center().x - a.x, p.center().y - a.y); if(d <= a.r){ p.health -= 0.8; } } } else if(a.type==='supernova'){ for(const p of Players){ const d=Math.hypot(p.center().x - a.x, p.center().y - a.y); if(d <= a.r){ const dirx = (a.x - p.center().x) / Math.max(1, d); const diry = (a.y - p.center().y) / Math.max(1, d); p.vx += dirx * 0.8; p.vy += diry * 0.7; } } } } } // Bombs update
    for(let i=Bombs.length-1;i>=0;i--){ if(!Bombs[i].update()) Bombs.splice(i,1); }

    // particles
    for(let i=Particles.length-1;i>=0;i--){ const pt = Particles[i]; pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.18; pt.life--; if(pt.life <= 0) Particles.splice(i,1); } if(Players[0].health <= 0 || Players[1].health <= 0){ const winner = Players[0].health > Players[1].health ? Players[0] : Players[1]; endRound(winner); } } else { Players.forEach(p=>{ if(Math.random() < 0.004) p.legFrame = 1; }); } render(); keyPress = {}; requestAnimationFrame(tick); }

/* --------------------- Render --------------------- */
function drawMap(ctx){ const g = ctx.createLinearGradient(0,0,W,H); g.addColorStop(0,'#081226'); g.addColorStop(1,'#061321'); ctx.fillStyle = g; ctx.fillRect(0,0,W,H); ctx.globalAlpha = 0.04; for(let i=0;i<6;i++){ ctx.fillStyle = ['#ff9a9e','#9be7ff','#d6b5ff','#ffd27a'][i%4]; ctx.beginPath(); ctx.ellipse((i*193+130)%W,(i*97+90)%H,240-i*20,120-i*10,0,0,Math.PI*2); ctx.fill(); } ctx.globalAlpha = 1; for(const p of currentMap.platforms){ ctx.fillStyle = '#0e2230'; roundRect(ctx,p.x,p.y,p.w,p.h,8); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.02)'; roundRect(ctx,p.x,p.y,p.w,4,4); ctx.fill(); } if(currentMap.lavaY){ ctx.fillStyle = '#7a0a01'; ctx.fillRect(0, currentMap.lavaY, W, H - currentMap.lavaY); } }
function render(){ drawMap(ctx); for(let i=0;i<AOEs.length;i++){ AOEs[i].draw(ctx); }
    for(let i=0;i<Bombs.length;i++){ Bombs[i].draw(ctx); } for(let i=0;i<Bullets.length;i++){ Bullets[i].draw(ctx); } const order = Players.slice().sort((A,B)=> (A.y+A.h) - (B.y+B.h)); order.forEach(p=> p.draw(ctx)); for(let i=0;i<Particles.length;i++){ const pt = Particles[i]; ctx.globalAlpha = clamp(pt.life/40,0,1); ctx.fillStyle = pt.color || '#fff'; ctx.beginPath(); ctx.arc(pt.x,pt.y,4,0,Math.PI*2); ctx.fill(); } ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(0,0,0,0.35)'; roundRect(ctx,12,12,360,88,10); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = '16px Inter, Arial'; ctx.textAlign = 'left'; ctx.fillText(`P1 ${scores.p1}  —  P2 ${scores.p2}`, 24, 36); ctx.font = '12px monospace'; ctx.fillText(`Round ${roundNumber} (First to ${TARGET_SCORE})`, 24, 58); ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText(`${Math.round(fps)} FPS`, W - 64, 36); if(pickState.active){ ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0,0,W,H); const boxW = Math.min(W * 0.92, 960), boxH = Math.min(H * 0.78, 360); const bx = (W - boxW)/2, by = (H - boxH)/2; ctx.fillStyle = '#18222f'; roundRect(ctx, bx, by, boxW, boxH, 20); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = '24px Inter, Arial'; ctx.textAlign = 'center'; ctx.fillText((pickState.currentPicker === 'p1' ? 'Player 1' : 'Player 2') + ' — PICK A CARD', W/2, by + 36); const cardW = (boxW - 80)/5, cardH = boxH - 100; for(let i=0;i<pickState.options.length;i++){ const card = pickState.options[i]; const cx = bx + 40 + i*cardW, cy = by + 60; ctx.fillStyle = '#243447'; roundRect(ctx, cx, cy, cardW - 10, cardH, 14); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = '18px Inter, Arial'; ctx.textAlign = 'left'; ctx.fillText(card.name, cx + 14, cy + 32); ctx.font = '13px Inter, Arial'; const wrapped = wrapText(ctx, card.desc || card.description || '', cardW - 40); for(let j=0;j<wrapped.length;j++){ ctx.fillText(wrapped[j], cx + 14, cy + 70 + j * 18); } ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillText((i+1).toString(), cx + cardW - 28, cy + 24); } } }



/* --------------------- Admin GUI  --------------------- */
// Simple admin panel — accessible locally. Player 1 is treated as admin by default.
window.__isAdmin = true; // change to false to disable
(function setupAdminUI(){
  const style = document.createElement('style');
  style.textContent = `
    #adminPanel{ position: fixed; right: 18px; top: 18px; width: 320px; max-width: 90vw; background: rgba(8,12,18,0.92); color: #fff; border-radius: 10px; padding: 12px; font-family: monospace; z-index: 9999; box-shadow: 0 8px 30px rgba(0,0,0,0.6); max-height:70vh; overflow:auto; display: none; }
    #adminPanel h3{ margin:0 0 8px 0; font-size:14px; }
    #adminPanel .row{ display:flex; gap:8px; margin:6px 0; }
    #adminPanel input, #adminPanel select{ flex:1; padding:6px 8px; background: rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.06); color:#fff; border-radius:6px; }
    #adminPanel button{ padding:6px 8px; background: linear-gradient(180deg,#2b7,#19a); border: none; color:#012; border-radius:6px; cursor:pointer; }
    #adminPanel small{ display:block; opacity:0.7; margin-top:6px; font-size:11px; }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'adminPanel';
  panel.innerHTML = `
    <h3>Admin Panel</h3>
    <div class="row">
      <select id="adminPlayer"><option value="0">Player 1</option><option value="1">Player 2</option></select>
      <button id="adminGod">God</button>
      <button id="adminUngod">Ungod</button>
    </div>


<div class="row">
  <select id="adminCardSelect" style="color:black" ></select>
  <input id="adminCardAmount" placeholder="Amount (e.g. 1)" />
  <button id="adminGiveCard">Give</button>
  <button id="adminGiveRandomCard">Give Random</button>
</div>


    <div class="row">
      <input id="adminAmount" placeholder="Amount (e.g. 2)" />
      <button id="adminGiveBounce">+Bounce</button>
      <button id="adminClearCards">Clear Cards</button>
    </div>

    <div class="row">
      <button id="adminKill">Kill</button>
      <button id="adminHeal">Heal</button>
      <button id="adminResetStats">Reset Stats</button>
    </div>

    <div class="row">
      <button id="adminClearBullets">Clear Bullets</button>
      <button id="adminClearAOE">Clear AOEs</button>
      <button id="adminSpawnDummy">Spawn Dummy</button>
    </div>

    <div class="row">
      <button id="adminResetRound">Reset Round</button>
      <button id="adminSpawnBullet">Spawn Bullet</button>
      <button id="adminForceReload">Force Reload</button>
    </div>

    <div class="row">
      <input id="adminSetReload" placeholder="Reload ms (e.g. 1200)" />
      <button id="adminApplyReload">Set Reload</button>
      <input id="adminSetDamage" placeholder="Damage (e.g. 10)" />
      <button id="adminApplyDamage">Set Dmg</button>
    </div>

    <div class="row">
      <input id="adminSetBulletSpeed" placeholder="Bullet speed (e.g. 8)" />
      <button id="adminApplyBSpd">Set Speed</button>
      <input id="adminSetMaxHealth" placeholder="Max HP (e.g. 100)" />
      <button id="adminApplyMaxHP">Set HP</button>
    </div>

    <div class="row">
      <input id="adminSetMoveSpeed" placeholder="Move speed (e.g. 4)" />
      <button id="adminApplyMove">Set Move</button>
      <input id="adminGiveAmmo" placeholder="Give ammo amount" />
      <button id="adminApplyAmmo">Give Ammo</button>
    </div>

    <div class="row">
      <input id="adminSetMultishot" placeholder="Multishot count" />
      <button id="adminApplyMulti">Set Multi</button>
      <input id="adminSetBurst" placeholder="Burst count" />
      <button id="adminApplyBurst">Set Burst</button>
    </div>

    <div class="row">
      <input id="adminSetBounce" placeholder="Bounce count" />
      <button id="adminApplyBounce">Set Bounce</button>
      <button id="adminToggleHoming">Toggle Homing</button>
      <button id="adminToggleExplosive">Toggle Explosive</button>
    </div>

    <div class="row">
      <button id="adminTeleport">Teleport (click player then click map)</button>
      <button id="adminNoClip">Toggle No-Clip</button>
      <button id="adminFreeze">Toggle Freeze</button>
    </div>

    <div class="row">
      <button id="adminInfiniteAmmo">Toggle Infinite Ammo</button>
      <button id="adminGiveRandomCard2">Give Random Card (alt)</button>
      <button id="adminRemoveAllCards">Remove All Cards</button>
    </div>

    <div class="row">
      <button id="adminShowHitboxes">Toggle Hitboxes</button>
      <button id="adminShowTrails">Toggle Bullet Trails</button>
      <button id="adminShowStatus">Toggle Status Timers</button>
    </div>

    <div class="row">
      <button id="adminCycleMap">Cycle Map</button>
      <button id="adminSlowMo">Toggle Slow Motion</button>
      <button id="adminToggleFPS">Toggle FPS</button>
    </div>

    <small>Toggle panel: ` + "`" + ` (backtick). Admin actions are local.</small>
  `;document.body.appendChild(panel);

  function isAdmin() { return window.__isAdmin; }

  function getSelectedPlayer(){
    const idx = parseInt(document.getElementById('adminPlayer').value) || 0;
    return Players[idx];
  }

  document.getElementById('adminGod').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const p = getSelectedPlayer();
    if(!p) return alert('Player not found');
    p.maxHealth = 99999; p.health = p.maxHealth; p.tint = {r:255,g:240,b:120,a:0.5};
  });

  document.getElementById('adminGiveCard').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const name = document.getElementById('adminCardName').value.trim();
    if(!name) return alert('Enter card name');
    const p = getSelectedPlayer(); if(!p) return alert('Player not found');
    // find card by name (case-insensitive)
    const card = CardPool.find(c => c.name.toLowerCase() === name.toLowerCase());
    if(card){ try{ card.apply(p); p.cards.push(card.name); alert('Gave card: '+card.name); }catch(e){ alert('Error applying card'); } }
    else { // allow arbitrary cards by simple flags
      if(name.toLowerCase().includes('grow')) p.hasGrow = true;
      if(name.toLowerCase().includes('bounce')) p.bounce = (p.bounce||0) + 2;
      alert('Gave custom card: '+name);
    }
  });

  document.getElementById('adminGiveBounce').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const amt = parseInt(document.getElementById('adminAmount').value) || 1;
    const p = getSelectedPlayer(); if(!p) return alert('Player not found');
    p.bounce = (p.bounce||0) + amt;
    alert('Added '+amt+' bounces');
  });

  document.getElementById('adminKill').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const p = getSelectedPlayer(); if(!p) return alert('Player not found');
    p.health = 0; p.alive = false; alert('Killed player');
  });

  document.getElementById('adminHeal').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const p = getSelectedPlayer(); if(!p) return alert('Player not found');
    p.health = p.maxHealth; alert('Healed');
  });

  document.getElementById('adminClearBullets').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    Bullets.length = 0; alert('Cleared bullets');
  });

  document.getElementById('adminClearAOE').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    AOEs.length = 0; alert('Cleared AOEs');
  });

  document.getElementById('adminResetRound').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    endRound(Players[0]); alert('Reset round (player1 winner)');
  });

  document.getElementById('adminSpawnBullet').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const p = getSelectedPlayer(); if(!p) return alert('Player not found');
    const mx = p.center().x + 60 * p.facing;
    const my = p.center().y;
    const speed = (p.bulletSpeed || 8) * (p.bulletSpeedMultiplier || 1);
    const vx = Math.cos(p.gunAngle) * speed; const vy = Math.sin(p.gunAngle) * speed;
    Bullets.push(new Bullet(mx, my, vx, vy, p, { damage: Math.max(1, p.baseDamage || 6) }));
    alert('Spawned bullet');
  });


  // --- Expanded admin listeners ---
  // Populate card dropdown
  const cardSelect = document.getElementById('adminCardSelect');
  if(cardSelect){
      CardPool.forEach(c=>{
          const opt=document.createElement('option');
          opt.value=c.name;
          opt.textContent=c.name; opt.style.color="black";
          cardSelect.appendChild(opt);
      });
  }

  // Give card with amount
  document.getElementById('adminGiveCard').addEventListener('click', ()=>{
      if(!isAdmin()) return alert('Not admin');
      const p = getSelectedPlayer(); if(!p) return alert("Player not found");
      const name = document.getElementById('adminCardSelect').value;
      const amt = parseInt(document.getElementById('adminCardAmount').value)||1;
      const card = CardPool.find(c=>c.name===name);
      if(!card) return alert("Card not found");
      for(let i=0;i<amt;i++){
          card.apply(p);
          p.cards.push(card.name);
      }
      alert('Gave '+amt+'x '+card.name);
  });

  function safeGetPlayer(){ const p = getSelectedPlayer(); if(!p) alert('Player not found'); return p; }

  document.getElementById('adminUngod').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const p = safeGetPlayer(); if(!p) return;
    p.maxHealth = Math.max(100, Math.round(p.maxHealth/100)); p.health = Math.min(p.health, p.maxHealth);
    alert('Ungod applied');
  });

  document.getElementById('adminGiveRandomCard').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const p = safeGetPlayer(); if(!p) return;
    const card = CardPool[randi(0, CardPool.length-1)];
    card.apply(p); p.cards.push(card.name);
    alert('Gave random card: '+card.name);
  });

  document.getElementById('adminGiveRandomCard2').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const p = safeGetPlayer(); if(!p) return;
    const card = CardPool[randi(0, CardPool.length-1)];
    card.apply(p); p.cards.push(card.name);
    alert('Gave random card: '+card.name);
  });

  document.getElementById('adminClearCards').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const p = safeGetPlayer(); if(!p) return;
    p.cards = []; alert('Cleared cards for player');
  });

  document.getElementById('adminResetStats').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const p = safeGetPlayer(); if(!p) return;
    // reset a safe subset of stats
    p.baseDamage = 10; p.bulletSpeed = 8; p.speed = 4.0; p._baseSpeed = p.speed;
    p.maxHealth = 100; p.health = Math.min(p.health, p.maxHealth);
    p.maxMag = 4; p.ammo = p.maxMag; p.reloadTime = 1200;
    p.bounce = 0; p.pierce = 0; p.explosive = 0;
    alert('Stats reset');
  });


  document.getElementById('adminSpawnDummy').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    alert("Click anywhere on the map to spawn a dummy.");

    function spawnClick(e){
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const d = new Player("d"+Date.now(), mx-15, my-15, "#888");

        d.status = { poison:0, burn:0, slow:0, parasite:0, toxic:0 };
        d.alive = true;
        d.health = 200;
        d.maxHealth = 200;

        Players.push(d);

        canvas.removeEventListener("click", spawnClick);
        alert("Dummy spawned!");
    }

    canvas.addEventListener("click", spawnClick);
  });


  document.getElementById('adminForceReload').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const p = safeGetPlayer(); if(!p) return;
    p.reload = Math.max(1, Math.round(p.reloadTime)); alert('Forced reload started');
  });

  document.getElementById('adminApplyReload').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const v = parseInt(document.getElementById('adminSetReload').value) || 1200;
    const p = safeGetPlayer(); if(!p) return;
    p.reloadTime = v; alert('Set reloadTime to '+v+' ms');
  });

  document.getElementById('adminApplyDamage').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const v = parseInt(document.getElementById('adminSetDamage').value) || 10;
    const p = safeGetPlayer(); if(!p) return;
    p.baseDamage = v; alert('Set baseDamage to '+v);
  });

  document.getElementById('adminApplyBSpd').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const v = parseFloat(document.getElementById('adminSetBulletSpeed').value) || 8;
    const p = safeGetPlayer(); if(!p) return;
    p.bulletSpeed = v; alert('Set bulletSpeed to '+v);
  });

  document.getElementById('adminApplyMaxHP').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const v = parseInt(document.getElementById('adminSetMaxHealth').value) || 100;
    const p = safeGetPlayer(); if(!p) return;
    p.maxHealth = v; p.health = Math.min(p.health, p.maxHealth); alert('Set maxHealth to '+v);
  });

  document.getElementById('adminApplyMove').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const v = parseFloat(document.getElementById('adminSetMoveSpeed').value) || 4.0;
    const p = safeGetPlayer(); if(!p) return;
    p.speed = v; p._baseSpeed = v; alert('Set move speed to '+v);
  });

  document.getElementById('adminApplyAmmo').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const v = parseInt(document.getElementById('adminGiveAmmo').value) || 10;
    const p = safeGetPlayer(); if(!p) return;
    p.ammo = Math.min(p.maxMag, p.ammo + v); alert('Gave '+v+' ammo (capped at maxMag)');
  });

  document.getElementById('adminApplyMulti').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const v = parseInt(document.getElementById('adminSetMultishot').value) || 1;
    const p = safeGetPlayer(); if(!p) return;
    p.multishotEnabled = v > 1; p.bulletsPerShot = v; alert('Set multishot to '+v);
  });

  document.getElementById('adminApplyBurst').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const v = parseInt(document.getElementById('adminSetBurst').value) || 1;
    const p = safeGetPlayer(); if(!p) return;
    p.burstEnabled = v > 1; p.burstCount = v; alert('Set burst to '+v);
  });

  document.getElementById('adminApplyBounce').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const v = parseInt(document.getElementById('adminSetBounce').value) || 0;
    const p = safeGetPlayer(); if(!p) return;
    p.bounce = v; alert('Set bounce to '+v);
  });

  document.getElementById('adminToggleHoming').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const p = safeGetPlayer(); if(!p) return;
    p._homing = !p._homing; alert('Homing = '+p._homing);
  });

  document.getElementById('adminToggleExplosive').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const p = safeGetPlayer(); if(!p) return;
    p.explosive = p.explosive ? 0 : 1; alert('Explosive = '+(p.explosive>0));
  });

  document.getElementById('adminTeleport').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    alert('Click anywhere on the canvas to teleport selected player');
    function onClick(e){
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const p = safeGetPlayer(); if(!p) return;
      p.x = mx - p.w/2; p.y = my - p.h/2; canvas.removeEventListener('click', onClick); alert('Teleported player');
    }
    canvas.addEventListener('click', onClick);
  });

  document.getElementById('adminNoClip').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    window.__noclip = !window.__noclip; alert('No-clip = '+!!window.__noclip);
  });

  document.getElementById('adminFreeze').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    window.__freeze = !window.__freeze; alert('Freeze = '+!!window.__freeze);
  });

  document.getElementById('adminInfiniteAmmo').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const p = safeGetPlayer(); if(!p) return;
    p.maxMag = p.maxMag === 9999 ? 4 : 9999; p.ammo = p.maxMag; alert('Toggled infinite ammo');
  });

  document.getElementById('adminRemoveAllCards').addEventListener('click', ()=>{
    if(!isAdmin()) return alert('Not admin');
    const p = safeGetPlayer(); if(!p) return;
    p.cards = []; alert('Removed all cards');
  });

  document.getElementById('adminShowHitboxes').addEventListener('click', ()=>{
    window.__showHitboxes = !window.__showHitboxes; alert('Show hitboxes = '+!!window.__showHitboxes);
  });
  document.getElementById('adminShowTrails').addEventListener('click', ()=>{
    window.__showTrails = !window.__showTrails; alert('Show trails = '+!!window.__showTrails);
  });
  document.getElementById('adminShowStatus').addEventListener('click', ()=>{
    window.__showStatus = !window.__showStatus; alert('Show status timers = '+!!window.__showStatus);
  });

  document.getElementById('adminCycleMap').addEventListener('click', ()=>{
    currentMap = Maps[(currentMap.id + 1) % Maps.length]; alert('Cycled map to '+currentMap.name);
  });

  document.getElementById('adminSlowMo').addEventListener('click', ()=>{
    window.__slowmo = !window.__slowmo; alert('Slow motion = '+!!window.__slowmo);
  });

  document.getElementById('adminToggleFPS').addEventListener('click', ()=>{
    window.__showFPS = !window.__showFPS; alert('FPS display toggle = '+!!window.__showFPS);
  });

// toggle panel with backtick key
  window.addEventListener('keydown', (e)=>{
    if(e.key === '`'){ if(!isAdmin()) return; panel.style.display = (panel.style.display === 'none') ? 'block' : 'none'; }
  });
})();

/* --------------------- Expose for debugging --------------------- */
window.__ColourBattle = { Players, Bullets, AOEs, CardPool, startSequence, startRound, createExplosion, createToxicCloud };

})(); });



/* ===== Admin Password Layer (Mode B) =====
   - Admin UI remains visible but actions are disabled until unlocked.
   - Password fetched from GitHub RAW URL; fallback to local saved password.
   - Local password can be saved; but user must click Unlock to auto-fill and verify.
*/
(function(){
  'use strict';
const PASS_URL = 'https://raw.githubusercontent.com/freesubstotally-beep/Password/refs/heads/main/password.html';

  const LOCAL_KEY = '__admin_ultra_localpass';
  const VERIFIED_KEY = '__admin_ultra_verified'; // store boolean string 'true' after verification in sessionStorage
  function log(){ try{ console.log('AdminPW:', ...arguments); }catch(e){} }
  let remotePass = null, remoteLoaded = false;

  // fetch remote password (best-effort)
  function loadRemote(){
    try{
      fetch(PASS_URL, {cache:'no-store'}).then(r=>{
        if(!r.ok) throw new Error('HTTP '+r.status);
        return r.text();
      }).then(t=>{ remotePass = (t||'').trim(); remoteLoaded = true; log('remote pass loaded'); }).catch(e=>{ remoteLoaded=false; log('remote load failed', e); });
    }catch(e){ log('remote fetch exception', e); remoteLoaded=false; }
  }
  loadRemote();

  function getSavedLocal(){
    try{ const v = localStorage.getItem(LOCAL_KEY); return v ? v : null; }catch(e){ return null; }
  }
  function saveLocalPlain(pass){
    try{ if(!pass) return; localStorage.setItem(LOCAL_KEY, btoa(unescape(encodeURIComponent(pass)))); log('local pass saved'); }catch(e){ log('save local failed', e); }
  }
  function getLocalPlain(){
    try{ const v = localStorage.getItem(LOCAL_KEY); if(!v) return null; return decodeURIComponent(escape(atob(v))); }catch(e){ return null; }
  }

  function isSessionVerified(){ try{ return sessionStorage.getItem(VERIFIED_KEY) === 'true'; }catch(e){ return false; } }
  function setSessionVerified(v){ try{ sessionStorage.setItem(VERIFIED_KEY, v ? 'true' : 'false'); }catch(e){} }

  function disableAdminButtons(root){
    if(!root) return;
    const btns = root.querySelectorAll('button, input[type="button"], input[type="submit"]');
    btns.forEach(b=>{
      if(b.dataset.adminPassExempt === 'true') return;
      b.disabled = true;
      b.classList.add('adm-locked');
    });
  }
  function enableAdminButtons(root){
    if(!root) return;
    const btns = root.querySelectorAll('button, input[type="button"], input[type="submit"]');
    btns.forEach(b=>{
      if(b.dataset.adminPassExempt === 'true') return;
      b.disabled = false;
      b.classList.remove('adm-locked');
    });
  }

  function injectControls(root){
    if(!root) return;
    if(root.querySelector('#adm_pw_container')) return;
    const container = document.createElement('div');
    container.id = 'adm_pw_container';
    container.style.cssText = 'margin-bottom:8px;padding:6px;border-radius:6px;background:rgba(255,255,255,0.02);display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
    container.innerHTML = `
      <label style="font-size:13px;color:#cfe">Admin password:
        <input id="adm_pw_input" type="password" placeholder="password" style="margin-left:6px;padding:4px;border-radius:4px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.03);color:#dff">
      </label>
      <button id="adm_pw_unlock" data-admin-pass-exempt="true" style="padding:6px;border-radius:6px;cursor:pointer">Unlock</button>
      <button id="adm_pw_save" data-admin-pass-exempt="true" style="padding:6px;border-radius:6px;cursor:pointer">Save (local)</button>
      <button id="adm_pw_use_saved" data-admin-pass-exempt="true" style="padding:6px;border-radius:6px;cursor:pointer">Use Saved</button>
      <span id="adm_pw_status" style="font-size:12px;opacity:0.9;margin-left:8px;color:#bff"></span>
    `;
    root.insertBefore(container, root.firstChild);

    const input = container.querySelector('#adm_pw_input');
    const btnUnlock = container.querySelector('#adm_pw_unlock');
    const btnSave = container.querySelector('#adm_pw_save');
    const btnUse = container.querySelector('#adm_pw_use_saved');
    const status = container.querySelector('#adm_pw_status');

    btnSave.addEventListener('click', ()=>{
      const v = input.value || getLocalPlain();
      if(!v){ alert('No password to save'); return; }
      saveLocalPlain(v);
      status.textContent = 'Saved locally (will be used when you press Use Saved)';
    });
    btnUse.addEventListener('click', ()=>{
      const p = getLocalPlain();
      if(!p){ alert('No saved password'); return; }
      input.value = p;
      status.textContent = 'Loaded saved (click Unlock to verify)';
    });

    btnUnlock.addEventListener('click', async ()=>{
      const attempt = input.value || '';
      status.textContent = 'Verifying...';
      try{
        if(remoteLoaded && remotePass !== null){
          if((attempt||'').trim() === remotePass){
            setSessionVerified(true);
            status.textContent = 'Verified (remote)';
            enableAdminButtons(root);
            return;
          } else {
            status.textContent = 'Remote verification failed';
            setSessionVerified(false);
            disableAdminButtons(root);
            return;
          }
        }
        const local = getLocalPlain();
        if(local && attempt === local){
          setSessionVerified(true);
          status.textContent = 'Verified (local)';
          enableAdminButtons(root);
          return;
        }
        status.textContent = 'Verification failed';
        setSessionVerified(false);
        disableAdminButtons(root);
      }catch(e){ console.error('adm verify err', e); status.textContent = 'Error'; setSessionVerified(false); disableAdminButtons(root); }
    });

    [btnUnlock, btnSave, btnUse, input].forEach(el=>{ if(el) el.dataset.adminPassExempt='true'; });

    if(isSessionVerified()){
      enableAdminButtons(root);
      status.textContent = 'Session already verified';
    } else {
      disableAdminButtons(root);
      status.textContent = 'Locked (enter password and click Unlock)';
    }
  }

  function findAdminRoot(){
    const ids = ['adminUltraWin','adminUltra','adminUltraFull','__admin_shim','adminPanel','adminPanelRoot'];
    for(const id of ids){
      const el = document.getElementById(id);
      if(el) return el;
    }
    const candidates = Array.from(document.querySelectorAll('div')).filter(d=>{
      const st = window.getComputedStyle(d);
      try{ return parseInt(st.zIndex) > 1000000000 || (st.position==='fixed' && st.display!=='none' && d.clientWidth>200); }catch(e){ return false; }
    });
    return candidates[0] || null;
  }

  function install(){
    const root = findAdminRoot();
    if(!root){
      let retries = 0;
      const t = setInterval(()=>{
        const r = findAdminRoot();
        if(r){ clearInterval(t); injectControls(r); }
        retries++;
        if(retries>40){ clearInterval(t); console.log('AdminPW: admin root not found'); }
      }, 250);
    } else {
      injectControls(root);
    }
  }

  if(document.readyState==='complete' || document.readyState==='interactive') install();
  else document.addEventListener('DOMContentLoaded', install);

  window.__AdminPW = { loadRemote, getLocalPlain, saveLocalPlain, isSessionVerified, setSessionVerified };

})(); // end password module
