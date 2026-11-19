// Lightweight WebGL renderer (WebGL2 with WebGL1 fallback).
// Flat-shaded, vertex-coloured low-poly style with sun + hemisphere light,
// fog, specular paint, a headlight spot light and a transparent/additive pass.
import { mat4 } from './math.js';

const MAIN_VS = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec4 aCol;
uniform mat4 uModel; uniform mat4 uVP;
varying vec4 vCol; varying vec3 vNrm; varying vec3 vWorld;
void main(){ vec4 w = uModel*vec4(aPos,1.0); vWorld=w.xyz; vNrm=mat3(uModel)*aNrm; vCol=aCol; gl_Position=uVP*w; }`;

const MAIN_FS = `
precision mediump float;
varying vec4 vCol; varying vec3 vNrm; varying vec3 vWorld;
uniform vec3 uTint; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uSky; uniform vec3 uGround;
uniform vec3 uFogCol; uniform vec2 uFog; uniform vec3 uCam; uniform float uEmissive; uniform float uSpec;
uniform vec3 uHeadPos; uniform vec3 uHeadDir; uniform float uHead;
void main(){
  vec3 n = normalize(vNrm);
  vec3 base = vCol.rgb*uTint;
  float emis = max(uEmissive, vCol.a);
  float d = max(dot(n,uSunDir),0.0);
  vec3 amb = mix(uGround,uSky,n.y*0.5+0.5);
  vec3 lit = amb + uSunCol*d;
  if (uHead > 0.0) {
    vec3 L = vWorld - uHeadPos; float dist = length(L); L /= dist;
    float cone = smoothstep(0.80, 0.95, dot(L,uHeadDir));
    lit += vec3(1.0,0.95,0.8) * uHead * cone * max(dot(n,-L),0.0) * 28.0 / (dist*dist*0.08+8.0);
  }
  vec3 c = base*lit;
  vec3 v = normalize(uCam - vWorld);
  if (uSpec > 0.0) {
    vec3 h = normalize(uSunDir+v);
    c += uSunCol*pow(max(dot(n,h),0.0),48.0)*uSpec;
    float fr = pow(1.0-max(dot(n,v),0.0),3.0);
    c += uSky*fr*uSpec*0.6;
  }
  c = mix(c, base*1.6, emis);
  float f = smoothstep(uFog.x,uFog.y,length(vWorld-uCam));
  c = mix(c, uFogCol, f*(1.0-emis*0.6));
  gl_FragColor = vec4(c,1.0);
}`;

const FX_VS = `
attribute vec3 aPos; attribute vec4 aCol; attribute vec2 aUV;
uniform mat4 uVP; varying vec4 vCol; varying vec2 vUV; varying vec3 vWorld;
void main(){ vCol=aCol; vUV=aUV; vWorld=aPos; gl_Position=uVP*vec4(aPos,1.0); }`;
const FX_FS = `
precision mediump float;
varying vec4 vCol; varying vec2 vUV; varying vec3 vWorld;
uniform vec3 uFogCol; uniform vec2 uFog; uniform vec3 uCam; uniform float uAdd;
void main(){
  float a = vCol.a * (1.0 - smoothstep(0.35,1.0,length(vUV)));
  float f = smoothstep(uFog.x,uFog.y,length(vWorld-uCam));
  if (uAdd > 0.5) { gl_FragColor = vec4(vCol.rgb*a*(1.0-f),1.0); }
  else { gl_FragColor = vec4(mix(vCol.rgb,uFogCol,f), a); }
}`;

const SKY_VS = `
attribute vec3 aPos; uniform mat4 uVP; uniform vec3 uCam; varying vec3 vDir;
void main(){ vDir=aPos; vec4 p = uVP*vec4(aPos*900.0+uCam,1.0); gl_Position=p.xyww; }`;
const SKY_FS = `
precision mediump float; varying vec3 vDir;
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uStars;
float hash(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 c = h>0.0 ? mix(uHorizon,uTop,pow(h,0.55)) : mix(uHorizon,uBottom,min(1.0,-h*4.0));
  float s = max(dot(d,uSunDir),0.0);
  c += uSunCol*(pow(s,600.0)*2.5 + pow(s,12.0)*0.25);
  if (uStars > 0.0 && h > 0.0) { float st = step(0.9985, hash(floor(d*400.0))); c += vec3(st)*uStars*h; }
  gl_FragColor = vec4(c,1.0);
}`;

function compile(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}, a = {};
  const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nu; i++) { const n = gl.getActiveUniform(p, i).name; u[n] = gl.getUniformLocation(p, n); }
  const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < na; i++) { const n = gl.getActiveAttrib(p, i).name; a[n] = gl.getAttribLocation(p, n); }
  return { p, u, a };
}

// A dynamic buffer of FX vertices (pos3 col4 uv2)
export class FxBuffer {
  constructor(renderer, maxVerts, additive = false) {
    this.r = renderer; this.gl = renderer.gl;
    this.data = new Float32Array(maxVerts * 9);
    this.max = maxVerts; this.count = 0; this.additive = additive;
    this.buf = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buf);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.data.byteLength, this.gl.DYNAMIC_DRAW);
    this.dirty = null; // [start,end) in vertices; null = none
    this.static = false;
  }
  markDirty(a, b) { if (!this.dirty) this.dirty = [a, b]; else { this.dirty[0] = Math.min(this.dirty[0], a); this.dirty[1] = Math.max(this.dirty[1], b); } }
  upload() {
    if (!this.dirty) return;
    const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const [a, b] = this.dirty;
    gl.bufferSubData(gl.ARRAY_BUFFER, a * 36, this.data.subarray(a * 9, b * 9));
    this.dirty = null;
  }
  dispose() { this.gl.deleteBuffer(this.buf); }
}

export class Renderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    const attrs = { antialias: !!opts.antialias, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve };
    let gl = canvas.getContext('webgl2', attrs);
    this.webgl2 = !!gl;
    if (!gl) gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
    if (!gl) throw new Error('WebGL is not available on this device/browser.');
    this.gl = gl;
    this.main = compile(gl, MAIN_VS, MAIN_FS);
    this.fx = compile(gl, FX_VS, FX_FS);
    this.skyP = compile(gl, SKY_VS, SKY_FS);
    this.vp = mat4.create(); this.view = mat4.create(); this.proj = mat4.create();
    this.camPos = [0, 5, -10];
    this.scale = 1;
    this.stats = { draws: 0, tris: 0 };
    this.frustum = new Float32Array(24);
    // sky sphere
    const sky = []; const N = 16, M = 10;
    for (let i = 0; i < M; i++) for (let j = 0; j < N; j++) {
      const t0 = (i / M) * Math.PI - Math.PI / 2, t1 = ((i + 1) / M) * Math.PI - Math.PI / 2;
      const p0 = (j / N) * Math.PI * 2, p1 = ((j + 1) / N) * Math.PI * 2;
      const P = (t, p) => [Math.cos(t) * Math.cos(p), Math.sin(t), Math.cos(t) * Math.sin(p)];
      sky.push(...P(t0, p0), ...P(t1, p0), ...P(t1, p1), ...P(t0, p0), ...P(t1, p1), ...P(t0, p1));
    }
    this.skyBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(sky), gl.STATIC_DRAW); this.skyCount = sky.length / 3;
    this.tmpM = mat4.create();
  }

  resize(scale = 1) {
    this.scale = scale;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * scale;
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr)), h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  // geometry: {pos:Float32Array, nrm:Float32Array, col:Float32Array(4 per vert)}
  createMesh(g) {
    const gl = this.gl;
    const mk = (arr) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW); return b; };
    // bounding sphere
    let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    const p = g.pos;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] < minx) minx = p[i]; if (p[i] > maxx) maxx = p[i];
      if (p[i + 1] < miny) miny = p[i + 1]; if (p[i + 1] > maxy) maxy = p[i + 1];
      if (p[i + 2] < minz) minz = p[i + 2]; if (p[i + 2] > maxz) maxz = p[i + 2];
    }
    const c = [(minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2];
    const rad = Math.hypot(maxx - minx, maxy - miny, maxz - minz) / 2;
    return { pos: mk(g.pos), nrm: mk(g.nrm), col: mk(g.col), count: p.length / 3, center: c, radius: rad };
  }
  deleteMesh(m) { if (!m) return; const gl = this.gl; gl.deleteBuffer(m.pos); gl.deleteBuffer(m.nrm); gl.deleteBuffer(m.col); }

  setCamera(eye, target, fov, near = 0.3, far = 1500) {
    const aspect = this.canvas.width / this.canvas.height;
    mat4.perspective(this.proj, fov, aspect, near, far);
    mat4.lookAt(this.view, eye, target, [0, 1, 0]);
    mat4.multiply(this.vp, this.proj, this.view);
    this.camPos = eye.slice();
    // frustum planes from VP
    const m = this.vp, f = this.frustum;
    const planes = [
      [m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]], [m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]],
      [m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]], [m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]],
      [m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]], [m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]],
    ];
    planes.forEach((pl, i) => { const l = Math.hypot(pl[0], pl[1], pl[2]); for (let k = 0; k < 4; k++) f[i * 4 + k] = pl[k] / l; });
  }
  sphereVisible(x, y, z, r) {
    const f = this.frustum;
    for (let i = 0; i < 6; i++) if (f[i * 4] * x + f[i * 4 + 1] * y + f[i * 4 + 2] * z + f[i * 4 + 3] < -r) return false;
    return true;
  }
  // project world point to CSS pixels; returns null if behind camera
  project(x, y, z) {
    const m = this.vp;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.1) return null;
    return [(cx / cw * 0.5 + 0.5) * this.canvas.clientWidth, (1 - (cy / cw * 0.5 + 0.5)) * this.canvas.clientHeight, cw];
  }

  // env: {sky:{top,horizon,bottom}, sunDir, sunCol, ambSky, ambGround, fogCol, fogNear, fogFar, stars}
  render(env, opaque, fxList, head) {
    const gl = this.gl;
    this.stats.draws = 0; this.stats.tris = 0;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(env.fogCol[0], env.fogCol[1], env.fogCol[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND); gl.depthMask(true);

    // --- opaque
    const S = this.main; gl.useProgram(S.p);
    gl.uniformMatrix4fv(S.u.uVP, false, this.vp);
    gl.uniform3fv(S.u.uSunDir, env.sunDir); gl.uniform3fv(S.u.uSunCol, env.sunCol);
    gl.uniform3fv(S.u.uSky, env.ambSky); gl.uniform3fv(S.u.uGround, env.ambGround);
    gl.uniform3fv(S.u.uFogCol, env.fogCol); gl.uniform2f(S.u.uFog, env.fogNear, env.fogFar);
    gl.uniform3fv(S.u.uCam, this.camPos);
    if (head && head.on) { gl.uniform3fv(S.u.uHeadPos, head.pos); gl.uniform3fv(S.u.uHeadDir, head.dir); gl.uniform1f(S.u.uHead, head.intensity); }
    else gl.uniform1f(S.u.uHead, 0);
    gl.enableVertexAttribArray(S.a.aPos); gl.enableVertexAttribArray(S.a.aNrm); gl.enableVertexAttribArray(S.a.aCol);
    for (const o of opaque) {
      const m = o.mesh; if (!m) continue;
      if (o.cull !== false) {
        const mm = o.matrix;
        const cx = mm ? mm[0] * m.center[0] + mm[4] * m.center[1] + mm[8] * m.center[2] + mm[12] : m.center[0];
        const cy = mm ? mm[1] * m.center[0] + mm[5] * m.center[1] + mm[9] * m.center[2] + mm[13] : m.center[1];
        const cz = mm ? mm[2] * m.center[0] + mm[6] * m.center[1] + mm[10] * m.center[2] + mm[14] : m.center[2];
        if (o.maxDist) { const dx = cx - this.camPos[0], dz = cz - this.camPos[2]; if (dx * dx + dz * dz > (o.maxDist + m.radius) ** 2) continue; }
        if (!this.sphereVisible(cx, cy, cz, m.radius * (o.scale || 1))) continue;
      }
      gl.uniformMatrix4fv(S.u.uModel, false, o.matrix || IDENTITY);
      gl.uniform3fv(S.u.uTint, o.tint || WHITE);
      gl.uniform1f(S.u.uEmissive, o.emissive || 0);
      gl.uniform1f(S.u.uSpec, o.spec || 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.pos); gl.vertexAttribPointer(S.a.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.nrm); gl.vertexAttribPointer(S.a.aNrm, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.col); gl.vertexAttribPointer(S.a.aCol, 4, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, m.count);
      this.stats.draws++; this.stats.tris += m.count / 3;
    }
    gl.disableVertexAttribArray(S.a.aNrm); gl.disableVertexAttribArray(S.a.aCol);

    // --- sky (drawn after opaque, at max depth)
    const K = this.skyP; gl.useProgram(K.p);
    gl.uniformMatrix4fv(K.u.uVP, false, this.vp); gl.uniform3fv(K.u.uCam, this.camPos);
    gl.uniform3fv(K.u.uTop, env.sky.top); gl.uniform3fv(K.u.uHorizon, env.sky.horizon); gl.uniform3fv(K.u.uBottom, env.sky.bottom);
    gl.uniform3fv(K.u.uSunDir, env.sunDir); gl.uniform3fv(K.u.uSunCol, env.sunGlow || env.sunCol); gl.uniform1f(K.u.uStars, env.stars || 0);
    gl.disable(gl.CULL_FACE); gl.depthMask(false);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuf); gl.enableVertexAttribArray(K.a.aPos); gl.vertexAttribPointer(K.a.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, this.skyCount);
    gl.disableVertexAttribArray(K.a.aPos);

    // --- fx (transparent then additive)
    const F = this.fx; gl.useProgram(F.p);
    gl.uniformMatrix4fv(F.u.uVP, false, this.vp);
    gl.uniform3fv(F.u.uFogCol, env.fogCol); gl.uniform2f(F.u.uFog, env.fogNear, env.fogFar); gl.uniform3fv(F.u.uCam, this.camPos);
    gl.enable(gl.BLEND);
    gl.enableVertexAttribArray(F.a.aPos); gl.enableVertexAttribArray(F.a.aCol); gl.enableVertexAttribArray(F.a.aUV);
    const sorted = fxList.filter(Boolean).sort((a, b) => (a.additive ? 1 : 0) - (b.additive ? 1 : 0));
    for (const b of sorted) {
      if (!b.count) continue;
      b.upload();
      if (b.additive) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(F.u.uAdd, b.additive ? 1 : 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
      gl.vertexAttribPointer(F.a.aPos, 3, gl.FLOAT, false, 36, 0);
      gl.vertexAttribPointer(F.a.aCol, 4, gl.FLOAT, false, 36, 12);
      gl.vertexAttribPointer(F.a.aUV, 2, gl.FLOAT, false, 36, 28);
      gl.drawArrays(gl.TRIANGLES, 0, b.count);
      this.stats.draws++;
    }
    gl.disableVertexAttribArray(F.a.aCol); gl.disableVertexAttribArray(F.a.aUV);
    gl.disable(gl.BLEND); gl.depthMask(true);
  }
}
const IDENTITY = mat4.create();
const WHITE = new Float32Array([1, 1, 1]);
