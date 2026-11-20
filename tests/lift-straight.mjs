const { Vehicle, PHYS_DT } = await import('../public/js/physics.js'); const { CARS, carDims } = await import('../public/js/cars.js');
const pad = { heightAt: () => 0, surfaceAt: () => ({ grip: 1, drag: 0 }), query: () => [], waterY: -1e9 };
const N = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false }; let ok = 0, n = 0; const bad = [];
for (const style of ['drift','race']) for (const c of CARS) for (const s of [1,-1]) for (const after of ['center','keepCounter']) {
  const v = new Vehicle(c, pad, carDims(c), { style, maxAngle: 62 }); v.place(0,0,0);
  for (let t=0;t<30&&v.speed<20;t+=PHYS_DT) v.step(PHYS_DT,{...N,throttle:1});
  for (let t=0;t<0.3;t+=PHYS_DT) v.step(PHYS_DT,{...N,throttle:0.7,steer:s,handbrake:true});
  for (let t=0;t<1.2;t+=PHYS_DT) v.step(PHYS_DT,{...N,throttle:0.9,steer:s*0.7});
  if (v.mode!=='drift') continue;
  // counter-steer with gas until within 10 degrees
  let t=0; for (;t<3 && !(Math.abs(v.rel)<0.17);t+=PHYS_DT) v.step(PHYS_DT,{...N,throttle:0.7,steer:-s*(style==='drift'?1:0.6)});
  if (Math.abs(v.rel)>=0.17 || v.mode!=='drift') { bad.push('SKIP '+style+' '+c.id+' rel '+(v.rel*57.3|0)+' '+v.mode); continue; } n++;
  const h0=v.h; let maxRel=0, drifted=false, gripT=null;
  for (let k=0;k<240;k++){ v.step(PHYS_DT,{...N,steer: after==='center'?0:-s*0.3}); if(k>12){maxRel=Math.max(maxRel,Math.abs(v.rel)); if(v.mode!=='grip') drifted=true;} if(gripT===null&&v.mode==='grip') gripT=k*PHYS_DT; }
  const good = gripT!==null && gripT<0.2 && !drifted && maxRel<0.2;
  if (good) ok++; else bad.push(`${style} ${c.id} ${s>0?'L':'R'} ${after}: grip@${gripT===null?'never':gripT.toFixed(2)} maxRel ${(maxRel*57.3)|0}° redrift ${drifted}`);
}
console.log(`straight after lift: ${ok}/${n}`); console.log(bad.slice(0,8).join('\n'));
