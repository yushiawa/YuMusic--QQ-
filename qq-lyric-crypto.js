// QQ Music lyric decryption (ported from Folia's bundled code)
// Decrypts the hex-encoded, 3DES-like encrypted lyric content returned by
// music.musichallSong.PlayLyricInfo, then raw-deflate decompresses it.
'use strict';
const zlib = require('zlib');
const X1 = [[14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],[15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,15,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],[10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],[7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,10,13,8,9,4,5,11,12,7,2,14],[2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],[12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],[4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],[13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11]];

function Z1(e,t,n){let r=Math.floor(t/32)*4+3-Math.floor(t%32/8),i=7-t%8;return(e[r]>>i&1)<<n}

function Q1(e,t,n){return(e>>>31-t&1)<<n}

function $1(e,t,n){return(e<<t&2147483648)>>>n}

function e0(e){return e&32|(e&31)>>1|(e&1)<<4}

function t0(e){return[(Z1(e,57,31)|Z1(e,49,30)|Z1(e,41,29)|Z1(e,33,28)|Z1(e,25,27)|Z1(e,17,26)|Z1(e,9,25)|Z1(e,1,24)|Z1(e,59,23)|Z1(e,51,22)|Z1(e,43,21)|Z1(e,35,20)|Z1(e,27,19)|Z1(e,19,18)|Z1(e,11,17)|Z1(e,3,16)|Z1(e,61,15)|Z1(e,53,14)|Z1(e,45,13)|Z1(e,37,12)|Z1(e,29,11)|Z1(e,21,10)|Z1(e,13,9)|Z1(e,5,8)|Z1(e,63,7)|Z1(e,55,6)|Z1(e,47,5)|Z1(e,39,4)|Z1(e,31,3)|Z1(e,23,2)|Z1(e,15,1)|Z1(e,7,0))>>>0,(Z1(e,56,31)|Z1(e,48,30)|Z1(e,40,29)|Z1(e,32,28)|Z1(e,24,27)|Z1(e,16,26)|Z1(e,8,25)|Z1(e,0,24)|Z1(e,58,23)|Z1(e,50,22)|Z1(e,42,21)|Z1(e,34,20)|Z1(e,26,19)|Z1(e,18,18)|Z1(e,10,17)|Z1(e,2,16)|Z1(e,60,15)|Z1(e,52,14)|Z1(e,44,13)|Z1(e,36,12)|Z1(e,28,11)|Z1(e,20,10)|Z1(e,12,9)|Z1(e,4,8)|Z1(e,62,7)|Z1(e,54,6)|Z1(e,46,5)|Z1(e,38,4)|Z1(e,30,3)|Z1(e,22,2)|Z1(e,14,1)|Z1(e,6,0))>>>0]}

function n0(e,t){let n=new Uint8Array(8);return n[3]=Q1(t,7,7)|Q1(e,7,6)|Q1(t,15,5)|Q1(e,15,4)|Q1(t,23,3)|Q1(e,23,2)|Q1(t,31,1)|Q1(e,31,0),n[2]=Q1(t,6,7)|Q1(e,6,6)|Q1(t,14,5)|Q1(e,14,4)|Q1(t,22,3)|Q1(e,22,2)|Q1(t,30,1)|Q1(e,30,0),n[1]=Q1(t,5,7)|Q1(e,5,6)|Q1(t,13,5)|Q1(e,13,4)|Q1(t,21,3)|Q1(e,21,2)|Q1(t,29,1)|Q1(e,29,0),n[0]=Q1(t,4,7)|Q1(e,4,6)|Q1(t,12,5)|Q1(e,12,4)|Q1(t,20,3)|Q1(e,20,2)|Q1(t,28,1)|Q1(e,28,0),n[7]=Q1(t,3,7)|Q1(e,3,6)|Q1(t,11,5)|Q1(e,11,4)|Q1(t,19,3)|Q1(e,19,2)|Q1(t,27,1)|Q1(e,27,0),n[6]=Q1(t,2,7)|Q1(e,2,6)|Q1(t,10,5)|Q1(e,10,4)|Q1(t,18,3)|Q1(e,18,2)|Q1(t,26,1)|Q1(e,26,0),n[5]=Q1(t,1,7)|Q1(e,1,6)|Q1(t,9,5)|Q1(e,9,4)|Q1(t,17,3)|Q1(e,17,2)|Q1(t,25,1)|Q1(e,25,0),n[4]=Q1(t,0,7)|Q1(e,0,6)|Q1(t,8,5)|Q1(e,8,4)|Q1(t,16,3)|Q1(e,16,2)|Q1(t,24,1)|Q1(e,24,0),n}

function r0(e,t){let n=($1(e,31,0)|(e&4026531840)>>>1|$1(e,4,5)|$1(e,3,6)|(e&251658240)>>>3|$1(e,8,11)|$1(e,7,12)|(e&15728640)>>>5|$1(e,12,17)|$1(e,11,18)|(e&983040)>>>7|$1(e,16,23))>>>0,r=($1(e,15,0)|(e&61440)<<15|$1(e,20,5)|$1(e,19,6)|(e&3840)<<13|$1(e,24,11)|$1(e,23,12)|(e&240)<<11|$1(e,28,17)|$1(e,27,18)|(e&15)<<9|$1(e,0,23))>>>0,i=[n>>>24&255,n>>>16&255,n>>>8&255,r>>>24&255,r>>>16&255,r>>>8&255].map((e,n)=>e^t[n]),a=(X1[0][e0(i[0]>>>2)]<<28|X1[1][e0((i[0]&3)<<4|i[1]>>>4)]<<24|X1[2][e0((i[1]&15)<<2|i[2]>>>6)]<<20|X1[3][e0(i[2]&63)]<<16|X1[4][e0(i[3]>>>2)]<<12|X1[5][e0((i[3]&3)<<4|i[4]>>>4)]<<8|X1[6][e0((i[4]&15)<<2|i[5]>>>6)]<<4|X1[7][e0(i[5]&63)])>>>0;return($1(a,15,0)|$1(a,6,1)|$1(a,19,2)|$1(a,20,3)|$1(a,28,4)|$1(a,11,5)|$1(a,27,6)|$1(a,16,7)|$1(a,0,8)|$1(a,14,9)|$1(a,22,10)|$1(a,25,11)|$1(a,4,12)|$1(a,17,13)|$1(a,30,14)|$1(a,9,15)|$1(a,1,16)|$1(a,7,17)|$1(a,23,18)|$1(a,13,19)|$1(a,31,20)|$1(a,26,21)|$1(a,2,22)|$1(a,8,23)|$1(a,18,24)|$1(a,12,25)|$1(a,29,26)|$1(a,5,27)|$1(a,21,28)|$1(a,10,29)|$1(a,3,30)|$1(a,24,31))>>>0}

function i0(e,t){let[n,r]=t0(e);for(let e=0;e<15;e++){let i=r;r=(r0(r,t[e])^n)>>>0,n=i}return n=(r0(r,t[15])^n)>>>0,n0(n,r)}

function a0(e,t){let n=Array.from({length:16},()=>[,,,,,,].fill(0)),r=[1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1],i=[56,48,40,32,24,16,8,0,57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35],a=[62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,60,52,44,36,28,20,12,4,27,19,11,3],o=[13,16,10,23,0,4,2,27,14,5,20,9,22,18,11,3,25,7,15,6,26,19,12,1,40,51,30,36,46,54,29,39,50,44,32,47,43,48,38,55,33,52,45,41,49,35,28,31],s=0;for(let t=0;t<28;t++)s|=Z1(e,i[t],31-t);s>>>=0;let c=0;for(let t=0;t<28;t++)c|=Z1(e,a[t],31-t);c>>>=0;for(let e=0;e<16;e++){s=((s<<r[e]|s>>>28-r[e])&4294967280)>>>0,c=((c<<r[e]|c>>>28-r[e])&4294967280)>>>0;let i=t===0?15-e:e;for(let e=0;e<6;e++)n[i][e]=0;for(let e=0;e<24;e++)n[i][Math.floor(e/8)]|=Q1(s,o[e],7-e%8);for(let e=24;e<48;e++)n[i][Math.floor(e/8)]|=Q1(c,o[e]-27,7-e%8)}return n}

function o0(e,t){let n=e.subarray(0,8),r=e.subarray(8,16),i=e.subarray(16,24);return t===1?[a0(n,1),a0(r,0),a0(i,1)]:[a0(i,0),a0(r,1),a0(n,0)]}

function s0(e,t){let n=e;for(let e=0;e<3;e++)n=i0(n,t[e]);return n}

async function c0(e){let t=new DecompressionStream(`deflate`),n=t.writable.getWriter();n.write(new Uint8Array(e)).catch(()=>{}),n.close().catch(()=>{});let r=t.readable.getReader(),i=[];try{for(;;){let{done:e,value:t}=await r.read();if(t&&i.push(t),e)break}}catch(e){if(i.length===0)throw e;console.warn(`DecompressionStream warning (ignored):`,e)}finally{r.releaseLock()}let a=i.reduce((e,t)=>e+t.length,0),o=new Uint8Array(a),s=0;for(let e of i)o.set(e,s),s+=e.length;return new TextDecoder(`utf-8`).decode(o)}

async function l0(e){let t;if(typeof e==`string`){let n=e.trim();t=new Uint8Array(n.match(/.{1,2}/g).map(e=>parseInt(e,16)))}else t=e;if(t.length===0)throw Error(`No data to decrypt`);let n=o0(new TextEncoder().encode(`!@#)(*$%123ZXC!@!@#)(NHL`),0),r=new Uint8Array(t.length);for(let e=0;e<t.length;e+=8){let i=t.subarray(e,Math.min(e+8,t.length)),a=i;i.length<8&&(a=new Uint8Array(8),a.set(i));let o=s0(a,n);r.set(o.subarray(0,i.length),e)}return await c0(r)}

function qqDecryptLyricContent(input) {
  // input: uppercase-hex string, or Buffer/Uint8Array of ciphertext
  let t;
  if (typeof input === 'string') {
    const hex = input.trim();
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
    t = new Uint8Array(bytes);
  } else {
    t = input instanceof Uint8Array ? input : new Uint8Array(input);
  }
  if (t.length === 0) return '';
  const keys = o0(new TextEncoder().encode('!@#)(*$%123ZXC!@!@#)(NHL'), 0);
  const r = new Uint8Array(t.length);
  for (let e = 0; e < t.length; e += 8) {
    let i = t.subarray(e, Math.min(e + 8, t.length));
    let a = i;
    if (i.length < 8) { a = new Uint8Array(8); a.set(i); }
    const o = s0(a, keys);
    r.set(o.subarray(0, i.length), e);
  }
  try {
    return zlib.inflateRawSync(Buffer.from(r.buffer, r.byteOffset, r.byteLength)).toString('utf8');
  } catch (err) {
    try { return zlib.inflateSync(Buffer.from(r.buffer, r.byteOffset, r.byteLength)).toString('utf8'); }
    catch (err2) { return Buffer.from(r.buffer, r.byteOffset, r.byteLength).toString('utf8'); }
  }
}
module.exports = { qqDecryptLyricContent, l0 };
