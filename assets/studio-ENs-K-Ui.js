const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/GenerateMeshBVHWorker-D-myiTYL.js","assets/index-G0pXPQFZ.js","assets/index-D5pfCJ6f.css","assets/Pass-Brjy3E1b.js"])))=>i.map(i=>d[i]);
var Pr=Object.defineProperty;var Cr=(s,e,t)=>e in s?Pr(s,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):s[e]=t;var B=(s,e,t)=>Cr(s,typeof e!="symbol"?e+"":e,t);import{a1 as H,B as F,a2 as er,a3 as le,V as Y,a4 as Qe,a5 as Fr,M as L,a6 as ne,a7 as tr,a8 as ir,a9 as Yt,aa as Je,ab as ee,v as O,ac as Ct,F as V,ad as Xt,ae as Dr,af as vi,ag as Er,ah as U,ai as Qt,aj as rr,ak as Br,al as sr,am as At,an as ve,ao as ar,ap as Le,G as zr,aq as nr,S as rt,N as it,W as et,ar as or,m as ce,H as ae,n as re,as as pe,at as xe,au as kr,av as Or,aw as Nr,ax as Hr,q as Ue,ay as Lr,az as ci,_ as cr,aA as Ur,aB as Wr,C as Vr,aC as qr,E as Gr,aD as $r,aE as xi,aF as Ft,aG as jr,aH as Yr,aI as Dt,aJ as Xr,aK as Qr,aL as Kr}from"./index-G0pXPQFZ.js";import{F as _e}from"./Pass-Brjy3E1b.js";const lr=0,Zr=1,ur=2,yi=2,Et=1.25,bi=1,ge=32,It=65535,Jr=Math.pow(2,-24),Bt=Symbol("SKIP_GENERATION");function fr(s){return s.index?s.index.count:s.attributes.position.count}function We(s){return fr(s)/3}function hr(s,e=ArrayBuffer){return s>65535?new Uint32Array(new e(4*s)):new Uint16Array(new e(2*s))}function es(s,e){if(!s.index){const t=s.attributes.position.count,i=e.useSharedArrayBuffer?SharedArrayBuffer:ArrayBuffer,a=hr(t,i);s.setIndex(new H(a,1));for(let n=0;n<t;n++)a[n]=n}}function dr(s,e){const t=We(s),i=e||s.drawRange,a=i.start/3,n=(i.start+i.count)/3,r=Math.max(0,a),c=Math.min(t,n)-r;return[{offset:Math.floor(r),count:Math.floor(c)}]}function mr(s,e){if(!s.groups||!s.groups.length)return dr(s,e);const t=[],i=new Set,a=e||s.drawRange,n=a.start/3,r=(a.start+a.count)/3;for(const l of s.groups){const h=l.start/3,f=(l.start+l.count)/3;i.add(Math.max(n,h)),i.add(Math.min(r,f))}const c=Array.from(i.values()).sort((l,h)=>l-h);for(let l=0;l<c.length-1;l++){const h=c[l],f=c[l+1];t.push({offset:Math.floor(h),count:Math.floor(f-h)})}return t}function ts(s,e){const t=We(s),i=mr(s,e).sort((r,c)=>r.offset-c.offset),a=i[i.length-1];a.count=Math.min(t-a.offset,a.count);let n=0;return i.forEach(({count:r})=>n+=r),t!==n}function zt(s,e,t,i,a){let n=1/0,r=1/0,c=1/0,l=-1/0,h=-1/0,f=-1/0,u=1/0,o=1/0,m=1/0,g=-1/0,x=-1/0,d=-1/0;for(let p=e*6,v=(e+t)*6;p<v;p+=6){const y=s[p+0],T=s[p+1],b=y-T,S=y+T;b<n&&(n=b),S>l&&(l=S),y<u&&(u=y),y>g&&(g=y);const w=s[p+2],A=s[p+3],_=w-A,I=w+A;_<r&&(r=_),I>h&&(h=I),w<o&&(o=w),w>x&&(x=w);const R=s[p+4],M=s[p+5],P=R-M,C=R+M;P<c&&(c=P),C>f&&(f=C),R<m&&(m=R),R>d&&(d=R)}i[0]=n,i[1]=r,i[2]=c,i[3]=l,i[4]=h,i[5]=f,a[0]=u,a[1]=o,a[2]=m,a[3]=g,a[4]=x,a[5]=d}function is(s,e=null,t=null,i=null){const a=s.attributes.position,n=s.index?s.index.array:null,r=We(s),c=a.normalized;let l;e===null?(l=new Float32Array(r*6*4),t=0,i=r):(l=e,t=t||0,i=i||r);const h=a.array,f=a.offset||0;let u=3;a.isInterleavedBufferAttribute&&(u=a.data.stride);const o=["getX","getY","getZ"];for(let m=t;m<t+i;m++){const g=m*3,x=m*6;let d=g+0,p=g+1,v=g+2;n&&(d=n[d],p=n[p],v=n[v]),c||(d=d*u+f,p=p*u+f,v=v*u+f);for(let y=0;y<3;y++){let T,b,S;c?(T=a[o[y]](d),b=a[o[y]](p),S=a[o[y]](v)):(T=h[d+y],b=h[p+y],S=h[v+y]);let w=T;b<w&&(w=b),S<w&&(w=S);let A=T;b>A&&(A=b),S>A&&(A=S);const _=(A-w)/2,I=y*2;l[x+I+0]=w+_,l[x+I+1]=_+(Math.abs(w)+_)*Jr}}return l}function k(s,e,t){return t.min.x=e[s],t.min.y=e[s+1],t.min.z=e[s+2],t.max.x=e[s+3],t.max.y=e[s+4],t.max.z=e[s+5],t}function Ti(s){let e=-1,t=-1/0;for(let i=0;i<3;i++){const a=s[i+3]-s[i];a>t&&(t=a,e=i)}return e}function wi(s,e){e.set(s)}function Si(s,e,t){let i,a;for(let n=0;n<3;n++){const r=n+3;i=s[n],a=e[n],t[n]=i<a?i:a,i=s[r],a=e[r],t[r]=i>a?i:a}}function st(s,e,t){for(let i=0;i<3;i++){const a=e[s+2*i],n=e[s+2*i+1],r=a-n,c=a+n;r<t[i]&&(t[i]=r),c>t[i+3]&&(t[i+3]=c)}}function Ve(s){const e=s[3]-s[0],t=s[4]-s[1],i=s[5]-s[2];return 2*(e*t+t*i+i*e)}const oe=32,rs=(s,e)=>s.candidate-e.candidate,he=new Array(oe).fill().map(()=>({count:0,bounds:new Float32Array(6),rightCacheBounds:new Float32Array(6),leftCacheBounds:new Float32Array(6),candidate:0})),at=new Float32Array(6);function ss(s,e,t,i,a,n){let r=-1,c=0;if(n===lr)r=Ti(e),r!==-1&&(c=(e[r]+e[r+3])/2);else if(n===Zr)r=Ti(s),r!==-1&&(c=as(t,i,a,r));else if(n===ur){const l=Ve(s);let h=Et*a;const f=i*6,u=(i+a)*6;for(let o=0;o<3;o++){const m=e[o],d=(e[o+3]-m)/oe;if(a<oe/4){const p=[...he];p.length=a;let v=0;for(let T=f;T<u;T+=6,v++){const b=p[v];b.candidate=t[T+2*o],b.count=0;const{bounds:S,leftCacheBounds:w,rightCacheBounds:A}=b;for(let _=0;_<3;_++)A[_]=1/0,A[_+3]=-1/0,w[_]=1/0,w[_+3]=-1/0,S[_]=1/0,S[_+3]=-1/0;st(T,t,S)}p.sort(rs);let y=a;for(let T=0;T<y;T++){const b=p[T];for(;T+1<y&&p[T+1].candidate===b.candidate;)p.splice(T+1,1),y--}for(let T=f;T<u;T+=6){const b=t[T+2*o];for(let S=0;S<y;S++){const w=p[S];b>=w.candidate?st(T,t,w.rightCacheBounds):(st(T,t,w.leftCacheBounds),w.count++)}}for(let T=0;T<y;T++){const b=p[T],S=b.count,w=a-b.count,A=b.leftCacheBounds,_=b.rightCacheBounds;let I=0;S!==0&&(I=Ve(A)/l);let R=0;w!==0&&(R=Ve(_)/l);const M=bi+Et*(I*S+R*w);M<h&&(r=o,h=M,c=b.candidate)}}else{for(let y=0;y<oe;y++){const T=he[y];T.count=0,T.candidate=m+d+y*d;const b=T.bounds;for(let S=0;S<3;S++)b[S]=1/0,b[S+3]=-1/0}for(let y=f;y<u;y+=6){let S=~~((t[y+2*o]-m)/d);S>=oe&&(S=oe-1);const w=he[S];w.count++,st(y,t,w.bounds)}const p=he[oe-1];wi(p.bounds,p.rightCacheBounds);for(let y=oe-2;y>=0;y--){const T=he[y],b=he[y+1];Si(T.bounds,b.rightCacheBounds,T.rightCacheBounds)}let v=0;for(let y=0;y<oe-1;y++){const T=he[y],b=T.count,S=T.bounds,A=he[y+1].rightCacheBounds;b!==0&&(v===0?wi(S,at):Si(S,at,at)),v+=b;let _=0,I=0;v!==0&&(_=Ve(at)/l);const R=a-v;R!==0&&(I=Ve(A)/l);const M=bi+Et*(_*v+I*R);M<h&&(r=o,h=M,c=T.candidate)}}}}else console.warn(`MeshBVH: Invalid build strategy value ${n} used.`);return{axis:r,pos:c}}function as(s,e,t,i){let a=0;for(let n=e,r=e+t;n<r;n++)a+=s[n*6+i*2];return a/t}class kt{constructor(){this.boundingData=new Float32Array(6)}}function ns(s,e,t,i,a,n){let r=i,c=i+a-1;const l=n.pos,h=n.axis*2;for(;;){for(;r<=c&&t[r*6+h]<l;)r++;for(;r<=c&&t[c*6+h]>=l;)c--;if(r<c){for(let f=0;f<3;f++){let u=e[r*3+f];e[r*3+f]=e[c*3+f],e[c*3+f]=u}for(let f=0;f<6;f++){let u=t[r*6+f];t[r*6+f]=t[c*6+f],t[c*6+f]=u}r++,c--}else return r}}function os(s,e,t,i,a,n){let r=i,c=i+a-1;const l=n.pos,h=n.axis*2;for(;;){for(;r<=c&&t[r*6+h]<l;)r++;for(;r<=c&&t[c*6+h]>=l;)c--;if(r<c){let f=s[r];s[r]=s[c],s[c]=f;for(let u=0;u<6;u++){let o=t[r*6+u];t[r*6+u]=t[c*6+u],t[c*6+u]=o}r++,c--}else return r}}function q(s,e){return e[s+15]===65535}function j(s,e){return e[s+6]}function Q(s,e){return e[s+14]}function Z(s){return s+8}function K(s,e){return e[s+6]}function li(s,e){return e[s+7]}let pr,Ke,_t,gr;const cs=Math.pow(2,32);function Kt(s){return"count"in s?1:1+Kt(s.left)+Kt(s.right)}function ls(s,e,t){return pr=new Float32Array(t),Ke=new Uint32Array(t),_t=new Uint16Array(t),gr=new Uint8Array(t),Zt(s,e)}function Zt(s,e){const t=s/4,i=s/2,a="count"in e,n=e.boundingData;for(let r=0;r<6;r++)pr[t+r]=n[r];if(a)if(e.buffer){const r=e.buffer;gr.set(new Uint8Array(r),s);for(let c=s,l=s+r.byteLength;c<l;c+=ge){const h=c/2;q(h,_t)||(Ke[c/4+6]+=t)}return s+r.byteLength}else{const r=e.offset,c=e.count;return Ke[t+6]=r,_t[i+14]=c,_t[i+15]=It,s+ge}else{const r=e.left,c=e.right,l=e.splitAxis;let h;if(h=Zt(s+ge,r),h/4>cs)throw new Error("MeshBVH: Cannot store child pointer greater than 32 bits.");return Ke[t+6]=h/4,h=Zt(h,c),Ke[t+7]=l,h}}function us(s,e){const t=(s.index?s.index.count:s.attributes.position.count)/3,i=t>2**16,a=i?4:2,n=e?new SharedArrayBuffer(t*a):new ArrayBuffer(t*a),r=i?new Uint32Array(n):new Uint16Array(n);for(let c=0,l=r.length;c<l;c++)r[c]=c;return r}function fs(s,e,t,i,a){const{maxDepth:n,verbose:r,maxLeafTris:c,strategy:l,onProgress:h,indirect:f}=a,u=s._indirectBuffer,o=s.geometry,m=o.index?o.index.array:null,g=f?os:ns,x=We(o),d=new Float32Array(6);let p=!1;const v=new kt;return zt(e,t,i,v.boundingData,d),T(v,t,i,d),v;function y(b){h&&h(b/x)}function T(b,S,w,A=null,_=0){if(!p&&_>=n&&(p=!0,r&&(console.warn(`MeshBVH: Max depth of ${n} reached when generating BVH. Consider increasing maxDepth.`),console.warn(o))),w<=c||_>=n)return y(S+w),b.offset=S,b.count=w,b;const I=ss(b.boundingData,A,e,S,w,l);if(I.axis===-1)return y(S+w),b.offset=S,b.count=w,b;const R=g(u,m,e,S,w,I);if(R===S||R===S+w)y(S+w),b.offset=S,b.count=w;else{b.splitAxis=I.axis;const M=new kt,P=S,C=R-S;b.left=M,zt(e,P,C,M.boundingData,d),T(M,P,C,d,_+1);const D=new kt,E=R,W=w-C;b.right=D,zt(e,E,W,D.boundingData,d),T(D,E,W,d,_+1)}return b}}function hs(s,e){const t=s.geometry;e.indirect&&(s._indirectBuffer=us(t,e.useSharedArrayBuffer),ts(t,e.range)&&!e.verbose&&console.warn('MeshBVH: Provided geometry contains groups or a range that do not fully span the vertex contents while using the "indirect" option. BVH may incorrectly report intersections on unrendered portions of the geometry.')),s._indirectBuffer||es(t,e);const i=e.useSharedArrayBuffer?SharedArrayBuffer:ArrayBuffer,a=is(t),n=e.indirect?dr(t,e.range):mr(t,e.range);s._roots=n.map(r=>{const c=fs(s,a,r.offset,r.count,e),l=Kt(c),h=new i(ge*l);return ls(0,c,h),h})}class ue{constructor(){this.min=1/0,this.max=-1/0}setFromPointsField(e,t){let i=1/0,a=-1/0;for(let n=0,r=e.length;n<r;n++){const l=e[n][t];i=l<i?l:i,a=l>a?l:a}this.min=i,this.max=a}setFromPoints(e,t){let i=1/0,a=-1/0;for(let n=0,r=t.length;n<r;n++){const c=t[n],l=e.dot(c);i=l<i?l:i,a=l>a?l:a}this.min=i,this.max=a}isSeparated(e){return this.min>e.max||e.min>this.max}}ue.prototype.setFromBox=(function(){const s=new F;return function(t,i){const a=i.min,n=i.max;let r=1/0,c=-1/0;for(let l=0;l<=1;l++)for(let h=0;h<=1;h++)for(let f=0;f<=1;f++){s.x=a.x*l+n.x*(1-l),s.y=a.y*h+n.y*(1-h),s.z=a.z*f+n.z*(1-f);const u=t.dot(s);r=Math.min(u,r),c=Math.max(u,c)}this.min=r,this.max=c}})();const ds=(function(){const s=new F,e=new F,t=new F;return function(a,n,r){const c=a.start,l=s,h=n.start,f=e;t.subVectors(c,h),s.subVectors(a.end,a.start),e.subVectors(n.end,n.start);const u=t.dot(f),o=f.dot(l),m=f.dot(f),g=t.dot(l),d=l.dot(l)*m-o*o;let p,v;d!==0?p=(u*o-g*m)/d:p=0,v=(u+p*o)/m,r.x=p,r.y=v}})(),ui=(function(){const s=new Y,e=new F,t=new F;return function(a,n,r,c){ds(a,n,s);let l=s.x,h=s.y;if(l>=0&&l<=1&&h>=0&&h<=1){a.at(l,r),n.at(h,c);return}else if(l>=0&&l<=1){h<0?n.at(0,c):n.at(1,c),a.closestPointToPoint(c,!0,r);return}else if(h>=0&&h<=1){l<0?a.at(0,r):a.at(1,r),n.closestPointToPoint(r,!0,c);return}else{let f;l<0?f=a.start:f=a.end;let u;h<0?u=n.start:u=n.end;const o=e,m=t;if(a.closestPointToPoint(u,!0,e),n.closestPointToPoint(f,!0,t),o.distanceToSquared(u)<=m.distanceToSquared(f)){r.copy(o),c.copy(u);return}else{r.copy(f),c.copy(m);return}}}})(),ms=(function(){const s=new F,e=new F,t=new er,i=new le;return function(n,r){const{radius:c,center:l}=n,{a:h,b:f,c:u}=r;if(i.start=h,i.end=f,i.closestPointToPoint(l,!0,s).distanceTo(l)<=c||(i.start=h,i.end=u,i.closestPointToPoint(l,!0,s).distanceTo(l)<=c)||(i.start=f,i.end=u,i.closestPointToPoint(l,!0,s).distanceTo(l)<=c))return!0;const x=r.getPlane(t);if(Math.abs(x.distanceToPoint(l))<=c){const p=x.projectPoint(l,e);if(r.containsPoint(p))return!0}return!1}})(),ps=1e-15;function Ot(s){return Math.abs(s)<ps}class se extends Qe{constructor(...e){super(...e),this.isExtendedTriangle=!0,this.satAxes=new Array(4).fill().map(()=>new F),this.satBounds=new Array(4).fill().map(()=>new ue),this.points=[this.a,this.b,this.c],this.sphere=new Fr,this.plane=new er,this.needsUpdate=!0}intersectsSphere(e){return ms(e,this)}update(){const e=this.a,t=this.b,i=this.c,a=this.points,n=this.satAxes,r=this.satBounds,c=n[0],l=r[0];this.getNormal(c),l.setFromPoints(c,a);const h=n[1],f=r[1];h.subVectors(e,t),f.setFromPoints(h,a);const u=n[2],o=r[2];u.subVectors(t,i),o.setFromPoints(u,a);const m=n[3],g=r[3];m.subVectors(i,e),g.setFromPoints(m,a),this.sphere.setFromPoints(this.points),this.plane.setFromNormalAndCoplanarPoint(c,e),this.needsUpdate=!1}}se.prototype.closestPointToSegment=(function(){const s=new F,e=new F,t=new le;return function(a,n=null,r=null){const{start:c,end:l}=a,h=this.points;let f,u=1/0;for(let o=0;o<3;o++){const m=(o+1)%3;t.start.copy(h[o]),t.end.copy(h[m]),ui(t,a,s,e),f=s.distanceToSquared(e),f<u&&(u=f,n&&n.copy(s),r&&r.copy(e))}return this.closestPointToPoint(c,s),f=c.distanceToSquared(s),f<u&&(u=f,n&&n.copy(s),r&&r.copy(c)),this.closestPointToPoint(l,s),f=l.distanceToSquared(s),f<u&&(u=f,n&&n.copy(s),r&&r.copy(l)),Math.sqrt(u)}})();se.prototype.intersectsTriangle=(function(){const s=new se,e=new Array(3),t=new Array(3),i=new ue,a=new ue,n=new F,r=new F,c=new F,l=new F,h=new F,f=new le,u=new le,o=new le,m=new F;function g(x,d,p){const v=x.points;let y=0,T=-1;for(let b=0;b<3;b++){const{start:S,end:w}=f;S.copy(v[b]),w.copy(v[(b+1)%3]),f.delta(r);const A=Ot(d.distanceToPoint(S));if(Ot(d.normal.dot(r))&&A){p.copy(f),y=2;break}const _=d.intersectLine(f,m);if(!_&&A&&m.copy(S),(_||A)&&!Ot(m.distanceTo(w))){if(y<=1)(y===1?p.start:p.end).copy(m),A&&(T=y);else if(y>=2){(T===1?p.start:p.end).copy(m),y=2;break}if(y++,y===2&&T===-1)break}}return y}return function(d,p=null,v=!1){this.needsUpdate&&this.update(),d.isExtendedTriangle?d.needsUpdate&&d.update():(s.copy(d),s.update(),d=s);const y=this.plane,T=d.plane;if(Math.abs(y.normal.dot(T.normal))>1-1e-10){const b=this.satBounds,S=this.satAxes;t[0]=d.a,t[1]=d.b,t[2]=d.c;for(let _=0;_<4;_++){const I=b[_],R=S[_];if(i.setFromPoints(R,t),I.isSeparated(i))return!1}const w=d.satBounds,A=d.satAxes;e[0]=this.a,e[1]=this.b,e[2]=this.c;for(let _=0;_<4;_++){const I=w[_],R=A[_];if(i.setFromPoints(R,e),I.isSeparated(i))return!1}for(let _=0;_<4;_++){const I=S[_];for(let R=0;R<4;R++){const M=A[R];if(n.crossVectors(I,M),i.setFromPoints(n,e),a.setFromPoints(n,t),i.isSeparated(a))return!1}}return p&&(v||console.warn("ExtendedTriangle.intersectsTriangle: Triangles are coplanar which does not support an output edge. Setting edge to 0, 0, 0."),p.start.set(0,0,0),p.end.set(0,0,0)),!0}else{const b=g(this,T,u);if(b===1&&d.containsPoint(u.end))return p&&(p.start.copy(u.end),p.end.copy(u.end)),!0;if(b!==2)return!1;const S=g(d,y,o);if(S===1&&this.containsPoint(o.end))return p&&(p.start.copy(o.end),p.end.copy(o.end)),!0;if(S!==2)return!1;if(u.delta(c),o.delta(l),c.dot(l)<0){let P=o.start;o.start=o.end,o.end=P}const w=u.start.dot(c),A=u.end.dot(c),_=o.start.dot(c),I=o.end.dot(c),R=A<_,M=w<I;return w!==I&&_!==A&&R===M?!1:(p&&(h.subVectors(u.start,o.start),h.dot(c)>0?p.start.copy(u.start):p.start.copy(o.start),h.subVectors(u.end,o.end),h.dot(c)<0?p.end.copy(u.end):p.end.copy(o.end)),!0)}}})();se.prototype.distanceToPoint=(function(){const s=new F;return function(t){return this.closestPointToPoint(t,s),t.distanceTo(s)}})();se.prototype.distanceToTriangle=(function(){const s=new F,e=new F,t=["a","b","c"],i=new le,a=new le;return function(r,c=null,l=null){const h=c||l?i:null;if(this.intersectsTriangle(r,h))return(c||l)&&(c&&h.getCenter(c),l&&h.getCenter(l)),0;let f=1/0;for(let u=0;u<3;u++){let o;const m=t[u],g=r[m];this.closestPointToPoint(g,s),o=g.distanceToSquared(s),o<f&&(f=o,c&&c.copy(s),l&&l.copy(g));const x=this[m];r.closestPointToPoint(x,s),o=x.distanceToSquared(s),o<f&&(f=o,c&&c.copy(x),l&&l.copy(s))}for(let u=0;u<3;u++){const o=t[u],m=t[(u+1)%3];i.set(this[o],this[m]);for(let g=0;g<3;g++){const x=t[g],d=t[(g+1)%3];a.set(r[x],r[d]),ui(i,a,s,e);const p=s.distanceToSquared(e);p<f&&(f=p,c&&c.copy(s),l&&l.copy(e))}}return Math.sqrt(f)}})();class G{constructor(e,t,i){this.isOrientedBox=!0,this.min=new F,this.max=new F,this.matrix=new L,this.invMatrix=new L,this.points=new Array(8).fill().map(()=>new F),this.satAxes=new Array(3).fill().map(()=>new F),this.satBounds=new Array(3).fill().map(()=>new ue),this.alignedSatBounds=new Array(3).fill().map(()=>new ue),this.needsUpdate=!1,e&&this.min.copy(e),t&&this.max.copy(t),i&&this.matrix.copy(i)}set(e,t,i){this.min.copy(e),this.max.copy(t),this.matrix.copy(i),this.needsUpdate=!0}copy(e){this.min.copy(e.min),this.max.copy(e.max),this.matrix.copy(e.matrix),this.needsUpdate=!0}}G.prototype.update=(function(){return function(){const e=this.matrix,t=this.min,i=this.max,a=this.points;for(let h=0;h<=1;h++)for(let f=0;f<=1;f++)for(let u=0;u<=1;u++){const o=1*h|2*f|4*u,m=a[o];m.x=h?i.x:t.x,m.y=f?i.y:t.y,m.z=u?i.z:t.z,m.applyMatrix4(e)}const n=this.satBounds,r=this.satAxes,c=a[0];for(let h=0;h<3;h++){const f=r[h],u=n[h],o=1<<h,m=a[o];f.subVectors(c,m),u.setFromPoints(f,a)}const l=this.alignedSatBounds;l[0].setFromPointsField(a,"x"),l[1].setFromPointsField(a,"y"),l[2].setFromPointsField(a,"z"),this.invMatrix.copy(this.matrix).invert(),this.needsUpdate=!1}})();G.prototype.intersectsBox=(function(){const s=new ue;return function(t){this.needsUpdate&&this.update();const i=t.min,a=t.max,n=this.satBounds,r=this.satAxes,c=this.alignedSatBounds;if(s.min=i.x,s.max=a.x,c[0].isSeparated(s)||(s.min=i.y,s.max=a.y,c[1].isSeparated(s))||(s.min=i.z,s.max=a.z,c[2].isSeparated(s)))return!1;for(let l=0;l<3;l++){const h=r[l],f=n[l];if(s.setFromBox(h,t),f.isSeparated(s))return!1}return!0}})();G.prototype.intersectsTriangle=(function(){const s=new se,e=new Array(3),t=new ue,i=new ue,a=new F;return function(r){this.needsUpdate&&this.update(),r.isExtendedTriangle?r.needsUpdate&&r.update():(s.copy(r),s.update(),r=s);const c=this.satBounds,l=this.satAxes;e[0]=r.a,e[1]=r.b,e[2]=r.c;for(let o=0;o<3;o++){const m=c[o],g=l[o];if(t.setFromPoints(g,e),m.isSeparated(t))return!1}const h=r.satBounds,f=r.satAxes,u=this.points;for(let o=0;o<3;o++){const m=h[o],g=f[o];if(t.setFromPoints(g,u),m.isSeparated(t))return!1}for(let o=0;o<3;o++){const m=l[o];for(let g=0;g<4;g++){const x=f[g];if(a.crossVectors(m,x),t.setFromPoints(a,e),i.setFromPoints(a,u),t.isSeparated(i))return!1}}return!0}})();G.prototype.closestPointToPoint=(function(){return function(e,t){return this.needsUpdate&&this.update(),t.copy(e).applyMatrix4(this.invMatrix).clamp(this.min,this.max).applyMatrix4(this.matrix),t}})();G.prototype.distanceToPoint=(function(){const s=new F;return function(t){return this.closestPointToPoint(t,s),t.distanceTo(s)}})();G.prototype.distanceToBox=(function(){const s=["x","y","z"],e=new Array(12).fill().map(()=>new le),t=new Array(12).fill().map(()=>new le),i=new F,a=new F;return function(r,c=0,l=null,h=null){if(this.needsUpdate&&this.update(),this.intersectsBox(r))return(l||h)&&(r.getCenter(a),this.closestPointToPoint(a,i),r.closestPointToPoint(i,a),l&&l.copy(i),h&&h.copy(a)),0;const f=c*c,u=r.min,o=r.max,m=this.points;let g=1/0;for(let d=0;d<8;d++){const p=m[d];a.copy(p).clamp(u,o);const v=p.distanceToSquared(a);if(v<g&&(g=v,l&&l.copy(p),h&&h.copy(a),v<f))return Math.sqrt(v)}let x=0;for(let d=0;d<3;d++)for(let p=0;p<=1;p++)for(let v=0;v<=1;v++){const y=(d+1)%3,T=(d+2)%3,b=p<<y|v<<T,S=1<<d|p<<y|v<<T,w=m[b],A=m[S];e[x].set(w,A);const I=s[d],R=s[y],M=s[T],P=t[x],C=P.start,D=P.end;C[I]=u[I],C[R]=p?u[R]:o[R],C[M]=v?u[M]:o[R],D[I]=o[I],D[R]=p?u[R]:o[R],D[M]=v?u[M]:o[R],x++}for(let d=0;d<=1;d++)for(let p=0;p<=1;p++)for(let v=0;v<=1;v++){a.x=d?o.x:u.x,a.y=p?o.y:u.y,a.z=v?o.z:u.z,this.closestPointToPoint(a,i);const y=a.distanceToSquared(i);if(y<g&&(g=y,l&&l.copy(i),h&&h.copy(a),y<f))return Math.sqrt(y)}for(let d=0;d<12;d++){const p=e[d];for(let v=0;v<12;v++){const y=t[v];ui(p,y,i,a);const T=i.distanceToSquared(a);if(T<g&&(g=T,l&&l.copy(i),h&&h.copy(a),T<f))return Math.sqrt(T)}}return Math.sqrt(g)}})();class fi{constructor(e){this._getNewPrimitive=e,this._primitives=[]}getPrimitive(){const e=this._primitives;return e.length===0?this._getNewPrimitive():e.pop()}releasePrimitive(e){this._primitives.push(e)}}class gs extends fi{constructor(){super(()=>new se)}}const J=new gs;class vs{constructor(){this.float32Array=null,this.uint16Array=null,this.uint32Array=null;const e=[];let t=null;this.setBuffer=i=>{t&&e.push(t),t=i,this.float32Array=new Float32Array(i),this.uint16Array=new Uint16Array(i),this.uint32Array=new Uint32Array(i)},this.clearBuffer=()=>{t=null,this.float32Array=null,this.uint16Array=null,this.uint32Array=null,e.length!==0&&this.setBuffer(e.pop())}}}const z=new vs;let me,He;const Ae=[],nt=new fi(()=>new ne);function xs(s,e,t,i,a,n){me=nt.getPrimitive(),He=nt.getPrimitive(),Ae.push(me,He),z.setBuffer(s._roots[e]);const r=Jt(0,s.geometry,t,i,a,n);z.clearBuffer(),nt.releasePrimitive(me),nt.releasePrimitive(He),Ae.pop(),Ae.pop();const c=Ae.length;return c>0&&(He=Ae[c-1],me=Ae[c-2]),r}function Jt(s,e,t,i,a=null,n=0,r=0){const{float32Array:c,uint16Array:l,uint32Array:h}=z;let f=s*2;if(q(f,l)){const o=j(s,h),m=Q(f,l);return k(s,c,me),i(o,m,!1,r,n+s,me)}else{let I=function(M){const{uint16Array:P,uint32Array:C}=z;let D=M*2;for(;!q(D,P);)M=Z(M),D=M*2;return j(M,C)},R=function(M){const{uint16Array:P,uint32Array:C}=z;let D=M*2;for(;!q(D,P);)M=K(M,C),D=M*2;return j(M,C)+Q(D,P)};const o=Z(s),m=K(s,h);let g=o,x=m,d,p,v,y;if(a&&(v=me,y=He,k(g,c,v),k(x,c,y),d=a(v),p=a(y),p<d)){g=m,x=o;const M=d;d=p,p=M,v=y}v||(v=me,k(g,c,v));const T=q(g*2,l),b=t(v,T,d,r+1,n+g);let S;if(b===yi){const M=I(g),C=R(g)-M;S=i(M,C,!0,r+1,n+g,v)}else S=b&&Jt(g,e,t,i,a,n,r+1);if(S)return!0;y=He,k(x,c,y);const w=q(x*2,l),A=t(y,w,p,r+1,n+x);let _;if(A===yi){const M=I(x),C=R(x)-M;_=i(M,C,!0,r+1,n+x,y)}else _=A&&Jt(x,e,t,i,a,n,r+1);return!!_}}const qe=new F,Nt=new F;function ys(s,e,t={},i=0,a=1/0){const n=i*i,r=a*a;let c=1/0,l=null;if(s.shapecast({boundsTraverseOrder:f=>(qe.copy(e).clamp(f.min,f.max),qe.distanceToSquared(e)),intersectsBounds:(f,u,o)=>o<c&&o<r,intersectsTriangle:(f,u)=>{f.closestPointToPoint(e,qe);const o=e.distanceToSquared(qe);return o<c&&(Nt.copy(qe),c=o,l=u),o<n}}),c===1/0)return null;const h=Math.sqrt(c);return t.point?t.point.copy(Nt):t.point=Nt.clone(),t.distance=h,t.faceIndex=l,t}const Me=new F,Ie=new F,Re=new F,ot=new Y,ct=new Y,lt=new Y,_i=new F,Ai=new F,Mi=new F,ut=new F;function bs(s,e,t,i,a,n,r,c){let l;if(n===tr?l=s.intersectTriangle(i,t,e,!0,a):l=s.intersectTriangle(e,t,i,n!==ir,a),l===null)return null;const h=s.origin.distanceTo(a);return h<r||h>c?null:{distance:h,point:a.clone()}}function Ts(s,e,t,i,a,n,r,c,l,h,f){Me.fromBufferAttribute(e,n),Ie.fromBufferAttribute(e,r),Re.fromBufferAttribute(e,c);const u=bs(s,Me,Ie,Re,ut,l,h,f);if(u){i&&(ot.fromBufferAttribute(i,n),ct.fromBufferAttribute(i,r),lt.fromBufferAttribute(i,c),u.uv=Qe.getInterpolation(ut,Me,Ie,Re,ot,ct,lt,new Y)),a&&(ot.fromBufferAttribute(a,n),ct.fromBufferAttribute(a,r),lt.fromBufferAttribute(a,c),u.uv1=Qe.getInterpolation(ut,Me,Ie,Re,ot,ct,lt,new Y)),t&&(_i.fromBufferAttribute(t,n),Ai.fromBufferAttribute(t,r),Mi.fromBufferAttribute(t,c),u.normal=Qe.getInterpolation(ut,Me,Ie,Re,_i,Ai,Mi,new F),u.normal.dot(s.direction)>0&&u.normal.multiplyScalar(-1));const o={a:n,b:r,c,normal:new F,materialIndex:0};Qe.getNormal(Me,Ie,Re,o.normal),u.face=o,u.faceIndex=n}return u}function Rt(s,e,t,i,a,n,r){const c=i*3;let l=c+0,h=c+1,f=c+2;const u=s.index;s.index&&(l=u.getX(l),h=u.getX(h),f=u.getX(f));const{position:o,normal:m,uv:g,uv1:x}=s.attributes,d=Ts(t,o,m,g,x,l,h,f,e,n,r);return d?(d.faceIndex=i,a&&a.push(d),d):null}function N(s,e,t,i){const a=s.a,n=s.b,r=s.c;let c=e,l=e+1,h=e+2;t&&(c=t.getX(c),l=t.getX(l),h=t.getX(h)),a.x=i.getX(c),a.y=i.getY(c),a.z=i.getZ(c),n.x=i.getX(l),n.y=i.getY(l),n.z=i.getZ(l),r.x=i.getX(h),r.y=i.getY(h),r.z=i.getZ(h)}function ws(s,e,t,i,a,n,r,c){const{geometry:l,_indirectBuffer:h}=s;for(let f=i,u=i+a;f<u;f++)Rt(l,e,t,f,n,r,c)}function Ss(s,e,t,i,a,n,r){const{geometry:c,_indirectBuffer:l}=s;let h=1/0,f=null;for(let u=i,o=i+a;u<o;u++){let m;m=Rt(c,e,t,u,null,n,r),m&&m.distance<h&&(f=m,h=m.distance)}return f}function _s(s,e,t,i,a,n,r){const{geometry:c}=t,{index:l}=c,h=c.attributes.position;for(let f=s,u=e+s;f<u;f++){let o;if(o=f,N(r,o*3,l,h),r.needsUpdate=!0,i(r,o,a,n))return!0}return!1}function As(s,e=null){e&&Array.isArray(e)&&(e=new Set(e));const t=s.geometry,i=t.index?t.index.array:null,a=t.attributes.position;let n,r,c,l,h=0;const f=s._roots;for(let o=0,m=f.length;o<m;o++)n=f[o],r=new Uint32Array(n),c=new Uint16Array(n),l=new Float32Array(n),u(0,h),h+=n.byteLength;function u(o,m,g=!1){const x=o*2;if(c[x+15]===It){const p=r[o+6],v=c[x+14];let y=1/0,T=1/0,b=1/0,S=-1/0,w=-1/0,A=-1/0;for(let _=3*p,I=3*(p+v);_<I;_++){let R=i[_];const M=a.getX(R),P=a.getY(R),C=a.getZ(R);M<y&&(y=M),M>S&&(S=M),P<T&&(T=P),P>w&&(w=P),C<b&&(b=C),C>A&&(A=C)}return l[o+0]!==y||l[o+1]!==T||l[o+2]!==b||l[o+3]!==S||l[o+4]!==w||l[o+5]!==A?(l[o+0]=y,l[o+1]=T,l[o+2]=b,l[o+3]=S,l[o+4]=w,l[o+5]=A,!0):!1}else{const p=o+8,v=r[o+6],y=p+m,T=v+m;let b=g,S=!1,w=!1;e?b||(S=e.has(y),w=e.has(T),b=!S&&!w):(S=!0,w=!0);const A=b||S,_=b||w;let I=!1;A&&(I=u(p,m,b));let R=!1;_&&(R=u(v,m,b));const M=I||R;if(M)for(let P=0;P<3;P++){const C=p+P,D=v+P,E=l[C],W=l[C+3],X=l[D],fe=l[D+3];l[o+P]=E<X?E:X,l[o+P+3]=W>fe?W:fe}return M}}}function ye(s,e,t,i,a){let n,r,c,l,h,f;const u=1/t.direction.x,o=1/t.direction.y,m=1/t.direction.z,g=t.origin.x,x=t.origin.y,d=t.origin.z;let p=e[s],v=e[s+3],y=e[s+1],T=e[s+3+1],b=e[s+2],S=e[s+3+2];return u>=0?(n=(p-g)*u,r=(v-g)*u):(n=(v-g)*u,r=(p-g)*u),o>=0?(c=(y-x)*o,l=(T-x)*o):(c=(T-x)*o,l=(y-x)*o),n>l||c>r||((c>n||isNaN(n))&&(n=c),(l<r||isNaN(r))&&(r=l),m>=0?(h=(b-d)*m,f=(S-d)*m):(h=(S-d)*m,f=(b-d)*m),n>f||h>r)?!1:((h>n||n!==n)&&(n=h),(f<r||r!==r)&&(r=f),n<=a&&r>=i)}function Ms(s,e,t,i,a,n,r,c){const{geometry:l,_indirectBuffer:h}=s;for(let f=i,u=i+a;f<u;f++){let o=h?h[f]:f;Rt(l,e,t,o,n,r,c)}}function Is(s,e,t,i,a,n,r){const{geometry:c,_indirectBuffer:l}=s;let h=1/0,f=null;for(let u=i,o=i+a;u<o;u++){let m;m=Rt(c,e,t,l?l[u]:u,null,n,r),m&&m.distance<h&&(f=m,h=m.distance)}return f}function Rs(s,e,t,i,a,n,r){const{geometry:c}=t,{index:l}=c,h=c.attributes.position;for(let f=s,u=e+s;f<u;f++){let o;if(o=t.resolveTriangleIndex(f),N(r,o*3,l,h),r.needsUpdate=!0,i(r,o,a,n))return!0}return!1}function Ps(s,e,t,i,a,n,r){z.setBuffer(s._roots[e]),ei(0,s,t,i,a,n,r),z.clearBuffer()}function ei(s,e,t,i,a,n,r){const{float32Array:c,uint16Array:l,uint32Array:h}=z,f=s*2;if(q(f,l)){const o=j(s,h),m=Q(f,l);ws(e,t,i,o,m,a,n,r)}else{const o=Z(s);ye(o,c,i,n,r)&&ei(o,e,t,i,a,n,r);const m=K(s,h);ye(m,c,i,n,r)&&ei(m,e,t,i,a,n,r)}}const Cs=["x","y","z"];function Fs(s,e,t,i,a,n){z.setBuffer(s._roots[e]);const r=ti(0,s,t,i,a,n);return z.clearBuffer(),r}function ti(s,e,t,i,a,n){const{float32Array:r,uint16Array:c,uint32Array:l}=z;let h=s*2;if(q(h,c)){const u=j(s,l),o=Q(h,c);return Ss(e,t,i,u,o,a,n)}else{const u=li(s,l),o=Cs[u],g=i.direction[o]>=0;let x,d;g?(x=Z(s),d=K(s,l)):(x=K(s,l),d=Z(s));const v=ye(x,r,i,a,n)?ti(x,e,t,i,a,n):null;if(v){const b=v.point[o];if(g?b<=r[d+u]:b>=r[d+u+3])return v}const T=ye(d,r,i,a,n)?ti(d,e,t,i,a,n):null;return v&&T?v.distance<=T.distance?v:T:v||T||null}}const ft=new ne,Pe=new se,Ce=new se,Ge=new L,Ii=new G,ht=new G;function Ds(s,e,t,i){z.setBuffer(s._roots[e]);const a=ii(0,s,t,i);return z.clearBuffer(),a}function ii(s,e,t,i,a=null){const{float32Array:n,uint16Array:r,uint32Array:c}=z;let l=s*2;if(a===null&&(t.boundingBox||t.computeBoundingBox(),Ii.set(t.boundingBox.min,t.boundingBox.max,i),a=Ii),q(l,r)){const f=e.geometry,u=f.index,o=f.attributes.position,m=t.index,g=t.attributes.position,x=j(s,c),d=Q(l,r);if(Ge.copy(i).invert(),t.boundsTree)return k(s,n,ht),ht.matrix.copy(Ge),ht.needsUpdate=!0,t.boundsTree.shapecast({intersectsBounds:v=>ht.intersectsBox(v),intersectsTriangle:v=>{v.a.applyMatrix4(i),v.b.applyMatrix4(i),v.c.applyMatrix4(i),v.needsUpdate=!0;for(let y=x*3,T=(d+x)*3;y<T;y+=3)if(N(Ce,y,u,o),Ce.needsUpdate=!0,v.intersectsTriangle(Ce))return!0;return!1}});for(let p=x*3,v=(d+x)*3;p<v;p+=3){N(Pe,p,u,o),Pe.a.applyMatrix4(Ge),Pe.b.applyMatrix4(Ge),Pe.c.applyMatrix4(Ge),Pe.needsUpdate=!0;for(let y=0,T=m.count;y<T;y+=3)if(N(Ce,y,m,g),Ce.needsUpdate=!0,Pe.intersectsTriangle(Ce))return!0}}else{const f=s+8,u=c[s+6];return k(f,n,ft),!!(a.intersectsBox(ft)&&ii(f,e,t,i,a)||(k(u,n,ft),a.intersectsBox(ft)&&ii(u,e,t,i,a)))}}const dt=new L,Ht=new G,$e=new G,Es=new F,Bs=new F,zs=new F,ks=new F;function Os(s,e,t,i={},a={},n=0,r=1/0){e.boundingBox||e.computeBoundingBox(),Ht.set(e.boundingBox.min,e.boundingBox.max,t),Ht.needsUpdate=!0;const c=s.geometry,l=c.attributes.position,h=c.index,f=e.attributes.position,u=e.index,o=J.getPrimitive(),m=J.getPrimitive();let g=Es,x=Bs,d=null,p=null;a&&(d=zs,p=ks);let v=1/0,y=null,T=null;return dt.copy(t).invert(),$e.matrix.copy(dt),s.shapecast({boundsTraverseOrder:b=>Ht.distanceToBox(b),intersectsBounds:(b,S,w)=>w<v&&w<r?(S&&($e.min.copy(b.min),$e.max.copy(b.max),$e.needsUpdate=!0),!0):!1,intersectsRange:(b,S)=>{if(e.boundsTree)return e.boundsTree.shapecast({boundsTraverseOrder:A=>$e.distanceToBox(A),intersectsBounds:(A,_,I)=>I<v&&I<r,intersectsRange:(A,_)=>{for(let I=A,R=A+_;I<R;I++){N(m,3*I,u,f),m.a.applyMatrix4(t),m.b.applyMatrix4(t),m.c.applyMatrix4(t),m.needsUpdate=!0;for(let M=b,P=b+S;M<P;M++){N(o,3*M,h,l),o.needsUpdate=!0;const C=o.distanceToTriangle(m,g,d);if(C<v&&(x.copy(g),p&&p.copy(d),v=C,y=M,T=I),C<n)return!0}}}});{const w=We(e);for(let A=0,_=w;A<_;A++){N(m,3*A,u,f),m.a.applyMatrix4(t),m.b.applyMatrix4(t),m.c.applyMatrix4(t),m.needsUpdate=!0;for(let I=b,R=b+S;I<R;I++){N(o,3*I,h,l),o.needsUpdate=!0;const M=o.distanceToTriangle(m,g,d);if(M<v&&(x.copy(g),p&&p.copy(d),v=M,y=I,T=A),M<n)return!0}}}}}),J.releasePrimitive(o),J.releasePrimitive(m),v===1/0?null:(i.point?i.point.copy(x):i.point=x.clone(),i.distance=v,i.faceIndex=y,a&&(a.point?a.point.copy(p):a.point=p.clone(),a.point.applyMatrix4(dt),x.applyMatrix4(dt),a.distance=x.sub(a.point).length(),a.faceIndex=T),i)}function Ns(s,e=null){e&&Array.isArray(e)&&(e=new Set(e));const t=s.geometry,i=t.index?t.index.array:null,a=t.attributes.position;let n,r,c,l,h=0;const f=s._roots;for(let o=0,m=f.length;o<m;o++)n=f[o],r=new Uint32Array(n),c=new Uint16Array(n),l=new Float32Array(n),u(0,h),h+=n.byteLength;function u(o,m,g=!1){const x=o*2;if(c[x+15]===It){const p=r[o+6],v=c[x+14];let y=1/0,T=1/0,b=1/0,S=-1/0,w=-1/0,A=-1/0;for(let _=p,I=p+v;_<I;_++){const R=3*s.resolveTriangleIndex(_);for(let M=0;M<3;M++){let P=R+M;P=i?i[P]:P;const C=a.getX(P),D=a.getY(P),E=a.getZ(P);C<y&&(y=C),C>S&&(S=C),D<T&&(T=D),D>w&&(w=D),E<b&&(b=E),E>A&&(A=E)}}return l[o+0]!==y||l[o+1]!==T||l[o+2]!==b||l[o+3]!==S||l[o+4]!==w||l[o+5]!==A?(l[o+0]=y,l[o+1]=T,l[o+2]=b,l[o+3]=S,l[o+4]=w,l[o+5]=A,!0):!1}else{const p=o+8,v=r[o+6],y=p+m,T=v+m;let b=g,S=!1,w=!1;e?b||(S=e.has(y),w=e.has(T),b=!S&&!w):(S=!0,w=!0);const A=b||S,_=b||w;let I=!1;A&&(I=u(p,m,b));let R=!1;_&&(R=u(v,m,b));const M=I||R;if(M)for(let P=0;P<3;P++){const C=p+P,D=v+P,E=l[C],W=l[C+3],X=l[D],fe=l[D+3];l[o+P]=E<X?E:X,l[o+P+3]=W>fe?W:fe}return M}}}function Hs(s,e,t,i,a,n,r){z.setBuffer(s._roots[e]),ri(0,s,t,i,a,n,r),z.clearBuffer()}function ri(s,e,t,i,a,n,r){const{float32Array:c,uint16Array:l,uint32Array:h}=z,f=s*2;if(q(f,l)){const o=j(s,h),m=Q(f,l);Ms(e,t,i,o,m,a,n,r)}else{const o=Z(s);ye(o,c,i,n,r)&&ri(o,e,t,i,a,n,r);const m=K(s,h);ye(m,c,i,n,r)&&ri(m,e,t,i,a,n,r)}}const Ls=["x","y","z"];function Us(s,e,t,i,a,n){z.setBuffer(s._roots[e]);const r=si(0,s,t,i,a,n);return z.clearBuffer(),r}function si(s,e,t,i,a,n){const{float32Array:r,uint16Array:c,uint32Array:l}=z;let h=s*2;if(q(h,c)){const u=j(s,l),o=Q(h,c);return Is(e,t,i,u,o,a,n)}else{const u=li(s,l),o=Ls[u],g=i.direction[o]>=0;let x,d;g?(x=Z(s),d=K(s,l)):(x=K(s,l),d=Z(s));const v=ye(x,r,i,a,n)?si(x,e,t,i,a,n):null;if(v){const b=v.point[o];if(g?b<=r[d+u]:b>=r[d+u+3])return v}const T=ye(d,r,i,a,n)?si(d,e,t,i,a,n):null;return v&&T?v.distance<=T.distance?v:T:v||T||null}}const mt=new ne,Fe=new se,De=new se,je=new L,Ri=new G,pt=new G;function Ws(s,e,t,i){z.setBuffer(s._roots[e]);const a=ai(0,s,t,i);return z.clearBuffer(),a}function ai(s,e,t,i,a=null){const{float32Array:n,uint16Array:r,uint32Array:c}=z;let l=s*2;if(a===null&&(t.boundingBox||t.computeBoundingBox(),Ri.set(t.boundingBox.min,t.boundingBox.max,i),a=Ri),q(l,r)){const f=e.geometry,u=f.index,o=f.attributes.position,m=t.index,g=t.attributes.position,x=j(s,c),d=Q(l,r);if(je.copy(i).invert(),t.boundsTree)return k(s,n,pt),pt.matrix.copy(je),pt.needsUpdate=!0,t.boundsTree.shapecast({intersectsBounds:v=>pt.intersectsBox(v),intersectsTriangle:v=>{v.a.applyMatrix4(i),v.b.applyMatrix4(i),v.c.applyMatrix4(i),v.needsUpdate=!0;for(let y=x,T=d+x;y<T;y++)if(N(De,3*e.resolveTriangleIndex(y),u,o),De.needsUpdate=!0,v.intersectsTriangle(De))return!0;return!1}});for(let p=x,v=d+x;p<v;p++){const y=e.resolveTriangleIndex(p);N(Fe,3*y,u,o),Fe.a.applyMatrix4(je),Fe.b.applyMatrix4(je),Fe.c.applyMatrix4(je),Fe.needsUpdate=!0;for(let T=0,b=m.count;T<b;T+=3)if(N(De,T,m,g),De.needsUpdate=!0,Fe.intersectsTriangle(De))return!0}}else{const f=s+8,u=c[s+6];return k(f,n,mt),!!(a.intersectsBox(mt)&&ai(f,e,t,i,a)||(k(u,n,mt),a.intersectsBox(mt)&&ai(u,e,t,i,a)))}}const gt=new L,Lt=new G,Ye=new G,Vs=new F,qs=new F,Gs=new F,$s=new F;function js(s,e,t,i={},a={},n=0,r=1/0){e.boundingBox||e.computeBoundingBox(),Lt.set(e.boundingBox.min,e.boundingBox.max,t),Lt.needsUpdate=!0;const c=s.geometry,l=c.attributes.position,h=c.index,f=e.attributes.position,u=e.index,o=J.getPrimitive(),m=J.getPrimitive();let g=Vs,x=qs,d=null,p=null;a&&(d=Gs,p=$s);let v=1/0,y=null,T=null;return gt.copy(t).invert(),Ye.matrix.copy(gt),s.shapecast({boundsTraverseOrder:b=>Lt.distanceToBox(b),intersectsBounds:(b,S,w)=>w<v&&w<r?(S&&(Ye.min.copy(b.min),Ye.max.copy(b.max),Ye.needsUpdate=!0),!0):!1,intersectsRange:(b,S)=>{if(e.boundsTree){const w=e.boundsTree;return w.shapecast({boundsTraverseOrder:A=>Ye.distanceToBox(A),intersectsBounds:(A,_,I)=>I<v&&I<r,intersectsRange:(A,_)=>{for(let I=A,R=A+_;I<R;I++){const M=w.resolveTriangleIndex(I);N(m,3*M,u,f),m.a.applyMatrix4(t),m.b.applyMatrix4(t),m.c.applyMatrix4(t),m.needsUpdate=!0;for(let P=b,C=b+S;P<C;P++){const D=s.resolveTriangleIndex(P);N(o,3*D,h,l),o.needsUpdate=!0;const E=o.distanceToTriangle(m,g,d);if(E<v&&(x.copy(g),p&&p.copy(d),v=E,y=P,T=I),E<n)return!0}}}})}else{const w=We(e);for(let A=0,_=w;A<_;A++){N(m,3*A,u,f),m.a.applyMatrix4(t),m.b.applyMatrix4(t),m.c.applyMatrix4(t),m.needsUpdate=!0;for(let I=b,R=b+S;I<R;I++){const M=s.resolveTriangleIndex(I);N(o,3*M,h,l),o.needsUpdate=!0;const P=o.distanceToTriangle(m,g,d);if(P<v&&(x.copy(g),p&&p.copy(d),v=P,y=I,T=A),P<n)return!0}}}}}),J.releasePrimitive(o),J.releasePrimitive(m),v===1/0?null:(i.point?i.point.copy(x):i.point=x.clone(),i.distance=v,i.faceIndex=y,a&&(a.point?a.point.copy(p):a.point=p.clone(),a.point.applyMatrix4(gt),x.applyMatrix4(gt),a.distance=x.sub(a.point).length(),a.faceIndex=T),i)}function Ys(){return typeof SharedArrayBuffer<"u"}const tt=new z.constructor,Mt=new z.constructor,de=new fi(()=>new ne),Ee=new ne,Be=new ne,Ut=new ne,Wt=new ne;let Vt=!1;function Xs(s,e,t,i){if(Vt)throw new Error("MeshBVH: Recursive calls to bvhcast not supported.");Vt=!0;const a=s._roots,n=e._roots;let r,c=0,l=0;const h=new L().copy(t).invert();for(let f=0,u=a.length;f<u;f++){tt.setBuffer(a[f]),l=0;const o=de.getPrimitive();k(0,tt.float32Array,o),o.applyMatrix4(h);for(let m=0,g=n.length;m<g&&(Mt.setBuffer(n[m]),r=ie(0,0,t,h,i,c,l,0,0,o),Mt.clearBuffer(),l+=n[m].length,!r);m++);if(de.releasePrimitive(o),tt.clearBuffer(),c+=a[f].length,r)break}return Vt=!1,r}function ie(s,e,t,i,a,n=0,r=0,c=0,l=0,h=null,f=!1){let u,o;f?(u=Mt,o=tt):(u=tt,o=Mt);const m=u.float32Array,g=u.uint32Array,x=u.uint16Array,d=o.float32Array,p=o.uint32Array,v=o.uint16Array,y=s*2,T=e*2,b=q(y,x),S=q(T,v);let w=!1;if(S&&b)f?w=a(j(e,p),Q(e*2,v),j(s,g),Q(s*2,x),l,r+e,c,n+s):w=a(j(s,g),Q(s*2,x),j(e,p),Q(e*2,v),c,n+s,l,r+e);else if(S){const A=de.getPrimitive();k(e,d,A),A.applyMatrix4(t);const _=Z(s),I=K(s,g);k(_,m,Ee),k(I,m,Be);const R=A.intersectsBox(Ee),M=A.intersectsBox(Be);w=R&&ie(e,_,i,t,a,r,n,l,c+1,A,!f)||M&&ie(e,I,i,t,a,r,n,l,c+1,A,!f),de.releasePrimitive(A)}else{const A=Z(e),_=K(e,p);k(A,d,Ut),k(_,d,Wt);const I=h.intersectsBox(Ut),R=h.intersectsBox(Wt);if(I&&R)w=ie(s,A,t,i,a,n,r,c,l+1,h,f)||ie(s,_,t,i,a,n,r,c,l+1,h,f);else if(I)if(b)w=ie(s,A,t,i,a,n,r,c,l+1,h,f);else{const M=de.getPrimitive();M.copy(Ut).applyMatrix4(t);const P=Z(s),C=K(s,g);k(P,m,Ee),k(C,m,Be);const D=M.intersectsBox(Ee),E=M.intersectsBox(Be);w=D&&ie(A,P,i,t,a,r,n,l,c+1,M,!f)||E&&ie(A,C,i,t,a,r,n,l,c+1,M,!f),de.releasePrimitive(M)}else if(R)if(b)w=ie(s,_,t,i,a,n,r,c,l+1,h,f);else{const M=de.getPrimitive();M.copy(Wt).applyMatrix4(t);const P=Z(s),C=K(s,g);k(P,m,Ee),k(C,m,Be);const D=M.intersectsBox(Ee),E=M.intersectsBox(Be);w=D&&ie(_,P,i,t,a,r,n,l,c+1,M,!f)||E&&ie(_,C,i,t,a,r,n,l,c+1,M,!f),de.releasePrimitive(M)}}return w}const vt=new G,Pi=new ne,Qs={strategy:lr,maxDepth:40,maxLeafTris:10,useSharedArrayBuffer:!1,setBoundingBox:!0,onProgress:null,indirect:!1,verbose:!0,range:null};class hi{static serialize(e,t={}){t={cloneBuffers:!0,...t};const i=e.geometry,a=e._roots,n=e._indirectBuffer,r=i.getIndex();let c;return t.cloneBuffers?c={roots:a.map(l=>l.slice()),index:r?r.array.slice():null,indirectBuffer:n?n.slice():null}:c={roots:a,index:r?r.array:null,indirectBuffer:n},c}static deserialize(e,t,i={}){i={setIndex:!0,indirect:!!e.indirectBuffer,...i};const{index:a,roots:n,indirectBuffer:r}=e,c=new hi(t,{...i,[Bt]:!0});if(c._roots=n,c._indirectBuffer=r||null,i.setIndex){const l=t.getIndex();if(l===null){const h=new H(e.index,1,!1);t.setIndex(h)}else l.array!==a&&(l.array.set(a),l.needsUpdate=!0)}return c}get indirect(){return!!this._indirectBuffer}constructor(e,t={}){if(e.isBufferGeometry){if(e.index&&e.index.isInterleavedBufferAttribute)throw new Error("MeshBVH: InterleavedBufferAttribute is not supported for the index attribute.")}else throw new Error("MeshBVH: Only BufferGeometries are supported.");if(t=Object.assign({...Qs,[Bt]:!1},t),t.useSharedArrayBuffer&&!Ys())throw new Error("MeshBVH: SharedArrayBuffer is not available.");this.geometry=e,this._roots=null,this._indirectBuffer=null,t[Bt]||(hs(this,t),!e.boundingBox&&t.setBoundingBox&&(e.boundingBox=this.getBoundingBox(new ne))),this.resolveTriangleIndex=t.indirect?i=>this._indirectBuffer[i]:i=>i}refit(e=null){return(this.indirect?Ns:As)(this,e)}traverse(e,t=0){const i=this._roots[t],a=new Uint32Array(i),n=new Uint16Array(i);r(0);function r(c,l=0){const h=c*2,f=n[h+15]===It;if(f){const u=a[c+6],o=n[h+14];e(l,f,new Float32Array(i,c*4,6),u,o)}else{const u=c+ge/4,o=a[c+6],m=a[c+7];e(l,f,new Float32Array(i,c*4,6),m)||(r(u,l+1),r(o,l+1))}}}raycast(e,t=Yt,i=0,a=1/0){const n=this._roots,r=this.geometry,c=[],l=t.isMaterial,h=Array.isArray(t),f=r.groups,u=l?t.side:t,o=this.indirect?Hs:Ps;for(let m=0,g=n.length;m<g;m++){const x=h?t[f[m].materialIndex].side:u,d=c.length;if(o(this,m,x,e,c,i,a),h){const p=f[m].materialIndex;for(let v=d,y=c.length;v<y;v++)c[v].face.materialIndex=p}}return c}raycastFirst(e,t=Yt,i=0,a=1/0){const n=this._roots,r=this.geometry,c=t.isMaterial,l=Array.isArray(t);let h=null;const f=r.groups,u=c?t.side:t,o=this.indirect?Us:Fs;for(let m=0,g=n.length;m<g;m++){const x=l?t[f[m].materialIndex].side:u,d=o(this,m,x,e,i,a);d!=null&&(h==null||d.distance<h.distance)&&(h=d,l&&(d.face.materialIndex=f[m].materialIndex))}return h}intersectsGeometry(e,t){let i=!1;const a=this._roots,n=this.indirect?Ws:Ds;for(let r=0,c=a.length;r<c&&(i=n(this,r,e,t),!i);r++);return i}shapecast(e){const t=J.getPrimitive(),i=this.indirect?Rs:_s;let{boundsTraverseOrder:a,intersectsBounds:n,intersectsRange:r,intersectsTriangle:c}=e;if(r&&c){const u=r;r=(o,m,g,x,d)=>u(o,m,g,x,d)?!0:i(o,m,this,c,g,x,t)}else r||(c?r=(u,o,m,g)=>i(u,o,this,c,m,g,t):r=(u,o,m)=>m);let l=!1,h=0;const f=this._roots;for(let u=0,o=f.length;u<o;u++){const m=f[u];if(l=xs(this,u,n,r,a,h),l)break;h+=m.byteLength}return J.releasePrimitive(t),l}bvhcast(e,t,i){let{intersectsRanges:a,intersectsTriangles:n}=i;const r=J.getPrimitive(),c=this.geometry.index,l=this.geometry.attributes.position,h=this.indirect?g=>{const x=this.resolveTriangleIndex(g);N(r,x*3,c,l)}:g=>{N(r,g*3,c,l)},f=J.getPrimitive(),u=e.geometry.index,o=e.geometry.attributes.position,m=e.indirect?g=>{const x=e.resolveTriangleIndex(g);N(f,x*3,u,o)}:g=>{N(f,g*3,u,o)};if(n){const g=(x,d,p,v,y,T,b,S)=>{for(let w=p,A=p+v;w<A;w++){m(w),f.a.applyMatrix4(t),f.b.applyMatrix4(t),f.c.applyMatrix4(t),f.needsUpdate=!0;for(let _=x,I=x+d;_<I;_++)if(h(_),r.needsUpdate=!0,n(r,f,_,w,y,T,b,S))return!0}return!1};if(a){const x=a;a=function(d,p,v,y,T,b,S,w){return x(d,p,v,y,T,b,S,w)?!0:g(d,p,v,y,T,b,S,w)}}else a=g}return Xs(this,e,t,a)}intersectsBox(e,t){return vt.set(e.min,e.max,t),vt.needsUpdate=!0,this.shapecast({intersectsBounds:i=>vt.intersectsBox(i),intersectsTriangle:i=>vt.intersectsTriangle(i)})}intersectsSphere(e){return this.shapecast({intersectsBounds:t=>e.intersectsBox(t),intersectsTriangle:t=>t.intersectsSphere(e)})}closestPointToGeometry(e,t,i={},a={},n=0,r=1/0){return(this.indirect?js:Os)(this,e,t,i,a,n,r)}closestPointToPoint(e,t={},i=0,a=1/0){return ys(this,e,t,i,a)}getBoundingBox(e){return e.makeEmpty(),this._roots.forEach(i=>{k(0,new Float32Array(i),Pi),e.union(Pi)}),e}}function Ks(s){switch(s){case 1:return"R";case 2:return"RG";case 3:return"RGBA";case 4:return"RGBA"}throw new Error}function Zs(s){switch(s){case 1:return At;case 2:return sr;case 3:return U;case 4:return U}}function Ci(s){switch(s){case 1:return Br;case 2:return rr;case 3:return Qt;case 4:return Qt}}class vr extends ee{constructor(){super(),this.minFilter=O,this.magFilter=O,this.generateMipmaps=!1,this.overrideItemSize=null,this._forcedType=null}updateFrom(e){const t=this.overrideItemSize,i=e.itemSize,a=e.count;if(t!==null){if(i*a%t!==0)throw new Error("VertexAttributeTexture: overrideItemSize must divide evenly into buffer length.");e.itemSize=t,e.count=a*i/t}const n=e.itemSize,r=e.count,c=e.normalized,l=e.array.constructor,h=l.BYTES_PER_ELEMENT;let f=this._forcedType,u=n;if(f===null)switch(l){case Float32Array:f=V;break;case Uint8Array:case Uint16Array:case Uint32Array:f=Je;break;case Int8Array:case Int16Array:case Int32Array:f=Ct;break}let o,m,g,x,d=Ks(n);switch(f){case V:g=1,m=Zs(n),c&&h===1?(x=l,d+="8",l===Uint8Array?o=Xt:(o=vi,d+="_SNORM")):(x=Float32Array,d+="32F",o=V);break;case Ct:d+=h*8+"I",g=c?Math.pow(2,l.BYTES_PER_ELEMENT*8-1):1,m=Ci(n),h===1?(x=Int8Array,o=vi):h===2?(x=Int16Array,o=Er):(x=Int32Array,o=Ct);break;case Je:d+=h*8+"UI",g=c?Math.pow(2,l.BYTES_PER_ELEMENT*8-1):1,m=Ci(n),h===1?(x=Uint8Array,o=Xt):h===2?(x=Uint16Array,o=Dr):(x=Uint32Array,o=Je);break}u===3&&(m===U||m===Qt)&&(u=4);const p=Math.ceil(Math.sqrt(r))||1,v=u*p*p,y=new x(v),T=e.normalized;e.normalized=!1;for(let b=0;b<r;b++){const S=u*b;y[S]=e.getX(b)/g,n>=2&&(y[S+1]=e.getY(b)/g),n>=3&&(y[S+2]=e.getZ(b)/g,u===4&&(y[S+3]=1)),n>=4&&(y[S+3]=e.getW(b)/g)}e.normalized=T,this.internalFormat=d,this.format=m,this.type=o,this.image.width=p,this.image.height=p,this.image.data=y,this.needsUpdate=!0,this.dispose(),e.itemSize=i,e.count=a}}class xr extends vr{constructor(){super(),this._forcedType=Je}}class yr extends vr{constructor(){super(),this._forcedType=V}}class Js{constructor(){this.index=new xr,this.position=new yr,this.bvhBounds=new ee,this.bvhContents=new ee,this._cachedIndexAttr=null,this.index.overrideItemSize=3}updateFrom(e){const{geometry:t}=e;if(ta(e,this.bvhBounds,this.bvhContents),this.position.updateFrom(t.attributes.position),e.indirect){const i=e._indirectBuffer;if(this._cachedIndexAttr===null||this._cachedIndexAttr.count!==i.length)if(t.index)this._cachedIndexAttr=t.index.clone();else{const a=hr(fr(t));this._cachedIndexAttr=new H(a,1,!1)}ea(t,i,this._cachedIndexAttr),this.index.updateFrom(this._cachedIndexAttr)}else this.index.updateFrom(t.index)}dispose(){const{index:e,position:t,bvhBounds:i,bvhContents:a}=this;e&&e.dispose(),t&&t.dispose(),i&&i.dispose(),a&&a.dispose()}}function ea(s,e,t){const i=t.array,a=s.index?s.index.array:null;for(let n=0,r=e.length;n<r;n++){const c=3*n,l=3*e[n];for(let h=0;h<3;h++)i[c+h]=a?a[l+h]:l+h}}function ta(s,e,t){const i=s._roots;if(i.length!==1)throw new Error("MeshBVHUniformStruct: Multi-root BVHs not supported.");const a=i[0],n=new Uint16Array(a),r=new Uint32Array(a),c=new Float32Array(a),l=a.byteLength/ge,h=2*Math.ceil(Math.sqrt(l/2)),f=new Float32Array(4*h*h),u=Math.ceil(Math.sqrt(l)),o=new Uint32Array(2*u*u);for(let m=0;m<l;m++){const g=m*ge/4,x=g*2,d=g;for(let p=0;p<3;p++)f[8*m+0+p]=c[d+0+p],f[8*m+4+p]=c[d+3+p];if(q(x,n)){const p=Q(x,n),v=j(g,r),y=4294901760|p;o[m*2+0]=y,o[m*2+1]=v}else{const p=4*K(g,r)/ge,v=li(g,r);o[m*2+0]=v,o[m*2+1]=p}}e.image.data=f,e.image.width=h,e.image.height=h,e.format=U,e.type=V,e.internalFormat="RGBA32F",e.minFilter=O,e.magFilter=O,e.generateMipmaps=!1,e.needsUpdate=!0,e.dispose(),t.image.data=o,t.image.width=u,t.image.height=u,t.format=rr,t.type=Je,t.internalFormat="RG32UI",t.minFilter=O,t.magFilter=O,t.generateMipmaps=!1,t.needsUpdate=!0,t.dispose()}const ia=`

// A stack of uint32 indices can can store the indices for
// a perfectly balanced tree with a depth up to 31. Lower stack
// depth gets higher performance.
//
// However not all trees are balanced. Best value to set this to
// is the trees max depth.
#ifndef BVH_STACK_DEPTH
#define BVH_STACK_DEPTH 60
#endif

#ifndef INFINITY
#define INFINITY 1e20
#endif

// Utilities
uvec4 uTexelFetch1D( usampler2D tex, uint index ) {

	uint width = uint( textureSize( tex, 0 ).x );
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, ivec2( uv ), 0 );

}

ivec4 iTexelFetch1D( isampler2D tex, uint index ) {

	uint width = uint( textureSize( tex, 0 ).x );
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, ivec2( uv ), 0 );

}

vec4 texelFetch1D( sampler2D tex, uint index ) {

	uint width = uint( textureSize( tex, 0 ).x );
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, ivec2( uv ), 0 );

}

vec4 textureSampleBarycoord( sampler2D tex, vec3 barycoord, uvec3 faceIndices ) {

	return
		barycoord.x * texelFetch1D( tex, faceIndices.x ) +
		barycoord.y * texelFetch1D( tex, faceIndices.y ) +
		barycoord.z * texelFetch1D( tex, faceIndices.z );

}

void ndcToCameraRay(
	vec2 coord, mat4 cameraWorld, mat4 invProjectionMatrix,
	out vec3 rayOrigin, out vec3 rayDirection
) {

	// get camera look direction and near plane for camera clipping
	vec4 lookDirection = cameraWorld * vec4( 0.0, 0.0, - 1.0, 0.0 );
	vec4 nearVector = invProjectionMatrix * vec4( 0.0, 0.0, - 1.0, 1.0 );
	float near = abs( nearVector.z / nearVector.w );

	// get the camera direction and position from camera matrices
	vec4 origin = cameraWorld * vec4( 0.0, 0.0, 0.0, 1.0 );
	vec4 direction = invProjectionMatrix * vec4( coord, 0.5, 1.0 );
	direction /= direction.w;
	direction = cameraWorld * direction - origin;

	// slide the origin along the ray until it sits at the near clip plane position
	origin.xyz += direction.xyz * near / dot( direction, lookDirection );

	rayOrigin = origin.xyz;
	rayDirection = direction.xyz;

}
`,ra=`

#ifndef TRI_INTERSECT_EPSILON
#define TRI_INTERSECT_EPSILON 1e-5
#endif

// Raycasting
bool intersectsBounds( vec3 rayOrigin, vec3 rayDirection, vec3 boundsMin, vec3 boundsMax, out float dist ) {

	// https://www.reddit.com/r/opengl/comments/8ntzz5/fast_glsl_ray_box_intersection/
	// https://tavianator.com/2011/ray_box.html
	vec3 invDir = 1.0 / rayDirection;

	// find intersection distances for each plane
	vec3 tMinPlane = invDir * ( boundsMin - rayOrigin );
	vec3 tMaxPlane = invDir * ( boundsMax - rayOrigin );

	// get the min and max distances from each intersection
	vec3 tMinHit = min( tMaxPlane, tMinPlane );
	vec3 tMaxHit = max( tMaxPlane, tMinPlane );

	// get the furthest hit distance
	vec2 t = max( tMinHit.xx, tMinHit.yz );
	float t0 = max( t.x, t.y );

	// get the minimum hit distance
	t = min( tMaxHit.xx, tMaxHit.yz );
	float t1 = min( t.x, t.y );

	// set distance to 0.0 if the ray starts inside the box
	dist = max( t0, 0.0 );

	return t1 >= dist;

}

bool intersectsTriangle(
	vec3 rayOrigin, vec3 rayDirection, vec3 a, vec3 b, vec3 c,
	out vec3 barycoord, out vec3 norm, out float dist, out float side
) {

	// https://stackoverflow.com/questions/42740765/intersection-between-line-and-triangle-in-3d
	vec3 edge1 = b - a;
	vec3 edge2 = c - a;
	norm = cross( edge1, edge2 );

	float det = - dot( rayDirection, norm );
	float invdet = 1.0 / det;

	vec3 AO = rayOrigin - a;
	vec3 DAO = cross( AO, rayDirection );

	vec4 uvt;
	uvt.x = dot( edge2, DAO ) * invdet;
	uvt.y = - dot( edge1, DAO ) * invdet;
	uvt.z = dot( AO, norm ) * invdet;
	uvt.w = 1.0 - uvt.x - uvt.y;

	// set the hit information
	barycoord = uvt.wxy; // arranged in A, B, C order
	dist = uvt.z;
	side = sign( det );
	norm = side * normalize( norm );

	// add an epsilon to avoid misses between triangles
	uvt += vec4( TRI_INTERSECT_EPSILON );

	return all( greaterThanEqual( uvt, vec4( 0.0 ) ) );

}

bool intersectTriangles(
	// geometry info and triangle range
	sampler2D positionAttr, usampler2D indexAttr, uint offset, uint count,

	// ray
	vec3 rayOrigin, vec3 rayDirection,

	// outputs
	inout float minDistance, inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord,
	inout float side, inout float dist
) {

	bool found = false;
	vec3 localBarycoord, localNormal;
	float localDist, localSide;
	for ( uint i = offset, l = offset + count; i < l; i ++ ) {

		uvec3 indices = uTexelFetch1D( indexAttr, i ).xyz;
		vec3 a = texelFetch1D( positionAttr, indices.x ).rgb;
		vec3 b = texelFetch1D( positionAttr, indices.y ).rgb;
		vec3 c = texelFetch1D( positionAttr, indices.z ).rgb;

		if (
			intersectsTriangle( rayOrigin, rayDirection, a, b, c, localBarycoord, localNormal, localDist, localSide )
			&& localDist < minDistance
		) {

			found = true;
			minDistance = localDist;

			faceIndices = uvec4( indices.xyz, i );
			faceNormal = localNormal;

			side = localSide;
			barycoord = localBarycoord;
			dist = localDist;

		}

	}

	return found;

}

bool intersectsBVHNodeBounds( vec3 rayOrigin, vec3 rayDirection, sampler2D bvhBounds, uint currNodeIndex, out float dist ) {

	uint cni2 = currNodeIndex * 2u;
	vec3 boundsMin = texelFetch1D( bvhBounds, cni2 ).xyz;
	vec3 boundsMax = texelFetch1D( bvhBounds, cni2 + 1u ).xyz;
	return intersectsBounds( rayOrigin, rayDirection, boundsMin, boundsMax, dist );

}

// use a macro to hide the fact that we need to expand the struct into separate fields
#define	bvhIntersectFirstHit(		bvh,		rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist	)	_bvhIntersectFirstHit(		bvh.position, bvh.index, bvh.bvhBounds, bvh.bvhContents,		rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist	)

bool _bvhIntersectFirstHit(
	// bvh info
	sampler2D bvh_position, usampler2D bvh_index, sampler2D bvh_bvhBounds, usampler2D bvh_bvhContents,

	// ray
	vec3 rayOrigin, vec3 rayDirection,

	// output variables split into separate variables due to output precision
	inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord,
	inout float side, inout float dist
) {

	// stack needs to be twice as long as the deepest tree we expect because
	// we push both the left and right child onto the stack every traversal
	int ptr = 0;
	uint stack[ BVH_STACK_DEPTH ];
	stack[ 0 ] = 0u;

	float triangleDistance = INFINITY;
	bool found = false;
	while ( ptr > - 1 && ptr < BVH_STACK_DEPTH ) {

		uint currNodeIndex = stack[ ptr ];
		ptr --;

		// check if we intersect the current bounds
		float boundsHitDistance;
		if (
			! intersectsBVHNodeBounds( rayOrigin, rayDirection, bvh_bvhBounds, currNodeIndex, boundsHitDistance )
			|| boundsHitDistance > triangleDistance
		) {

			continue;

		}

		uvec2 boundsInfo = uTexelFetch1D( bvh_bvhContents, currNodeIndex ).xy;
		bool isLeaf = bool( boundsInfo.x & 0xffff0000u );

		if ( isLeaf ) {

			uint count = boundsInfo.x & 0x0000ffffu;
			uint offset = boundsInfo.y;

			found = intersectTriangles(
				bvh_position, bvh_index, offset, count,
				rayOrigin, rayDirection, triangleDistance,
				faceIndices, faceNormal, barycoord, side, dist
			) || found;

		} else {

			uint leftIndex = currNodeIndex + 1u;
			uint splitAxis = boundsInfo.x & 0x0000ffffu;
			uint rightIndex = boundsInfo.y;

			bool leftToRight = rayDirection[ splitAxis ] >= 0.0;
			uint c1 = leftToRight ? leftIndex : rightIndex;
			uint c2 = leftToRight ? rightIndex : leftIndex;

			// set c2 in the stack so we traverse it later. We need to keep track of a pointer in
			// the stack while we traverse. The second pointer added is the one that will be
			// traversed first
			ptr ++;
			stack[ ptr ] = c2;

			ptr ++;
			stack[ ptr ] = c1;

		}

	}

	return found;

}
`,sa=`
struct BVH {

	usampler2D index;
	sampler2D position;

	sampler2D bvhBounds;
	usampler2D bvhContents;

};
`;function br(s,e,t=0){if(s.isInterleavedBufferAttribute){const i=s.itemSize;for(let a=0,n=s.count;a<n;a++){const r=a+t;e.setX(r,s.getX(a)),i>=2&&e.setY(r,s.getY(a)),i>=3&&e.setZ(r,s.getZ(a)),i>=4&&e.setW(r,s.getW(a))}}else{const i=e.array,a=i.constructor,n=i.BYTES_PER_ELEMENT*s.itemSize*t;new a(i.buffer,n,s.array.length).set(s.array)}}function Ze(s,e=null){const t=s.array.constructor,i=s.normalized,a=s.itemSize,n=e===null?s.count:e;return new H(new t(a*n),a,i)}function Ne(s,e){if(!s&&!e)return!0;if(!!s!=!!e)return!1;const t=s.count===e.count,i=s.normalized===e.normalized,a=s.array.constructor===e.array.constructor,n=s.itemSize===e.itemSize;return!(!t||!i||!a||!n)}function aa(s){const e=s[0].index!==null,t=new Set(Object.keys(s[0].attributes));if(!s[0].getAttribute("position"))throw new Error("StaticGeometryGenerator: position attribute is required.");for(let i=0;i<s.length;++i){const a=s[i];let n=0;if(e!==(a.index!==null))throw new Error("StaticGeometryGenerator: All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them.");for(const r in a.attributes){if(!t.has(r))throw new Error('StaticGeometryGenerator: All geometries must have compatible attributes; make sure "'+r+'" attribute exists among all geometries, or in none of them.');n++}if(n!==t.size)throw new Error("StaticGeometryGenerator: All geometries must have the same number of attributes.")}}function na(s){let e=0;for(let t=0,i=s.length;t<i;t++)e+=s[t].getIndex().count;return e}function oa(s){let e=0;for(let t=0,i=s.length;t<i;t++)e+=s[t].getAttribute("position").count;return e}function ca(s,e,t){s.index&&s.index.count!==e&&s.setIndex(null);const i=s.attributes;for(const a in i)i[a].count!==t&&s.deleteAttribute(a)}function la(s,e={},t=new ve){const{useGroups:i=!1,forceUpdate:a=!1,skipAssigningAttributes:n=[],overwriteIndex:r=!0}=e;aa(s);const c=s[0].index!==null,l=c?na(s):-1,h=oa(s);if(ca(t,l,h),i){let u=0;for(let o=0,m=s.length;o<m;o++){const g=s[o];let x;c?x=g.getIndex().count:x=g.getAttribute("position").count,t.addGroup(u,x,o),u+=x}}if(c){let u=!1;if(t.index||(t.setIndex(new H(new Uint32Array(l),1,!1)),u=!0),u||r){let o=0,m=0;const g=t.getIndex();for(let x=0,d=s.length;x<d;x++){const p=s[x],v=p.getIndex();if(!(!a&&!u&&n[x]))for(let T=0;T<v.count;++T)g.setX(o+T,v.getX(T)+m);o+=v.count,m+=p.getAttribute("position").count}}}const f=Object.keys(s[0].attributes);for(let u=0,o=f.length;u<o;u++){let m=!1;const g=f[u];if(!t.getAttribute(g)){const p=s[0].getAttribute(g);t.setAttribute(g,Ze(p,h)),m=!0}let x=0;const d=t.getAttribute(g);for(let p=0,v=s.length;p<v;p++){const y=s[p],T=!a&&!m&&n[p],b=y.getAttribute(g);T||br(b,d,x),x+=b.count}}}function ua(s,e,t){const i=s.index,n=s.attributes.position.count,r=i?i.count:n;let c=s.groups;c.length===0&&(c=[{count:r,start:0,materialIndex:0}]);let l=s.getAttribute("materialIndex");if(!l||l.count!==n){let f;t.length<=255?f=new Uint8Array(n):f=new Uint16Array(n),l=new H(f,1,!1),s.deleteAttribute("materialIndex"),s.setAttribute("materialIndex",l)}const h=l.array;for(let f=0;f<c.length;f++){const u=c[f],o=u.start,m=u.count,g=Math.min(m,r-o),x=Array.isArray(e)?e[u.materialIndex]:e,d=t.indexOf(x);for(let p=0;p<g;p++){let v=o+p;i&&(v=i.getX(v)),h[v]=d}}}function fa(s,e){if(!s.index){const t=s.attributes.position.count,i=new Array(t);for(let a=0;a<t;a++)i[a]=a;s.setIndex(i)}if(!s.attributes.normal&&e&&e.includes("normal")&&s.computeVertexNormals(),!s.attributes.uv&&e&&e.includes("uv")){const t=s.attributes.position.count;s.setAttribute("uv",new H(new Float32Array(t*2),2,!1))}if(!s.attributes.uv2&&e&&e.includes("uv2")){const t=s.attributes.position.count;s.setAttribute("uv2",new H(new Float32Array(t*2),2,!1))}if(!s.attributes.tangent&&e&&e.includes("tangent"))if(s.attributes.uv&&s.attributes.normal)s.computeTangents();else{const t=s.attributes.position.count;s.setAttribute("tangent",new H(new Float32Array(t*4),4,!1))}if(!s.attributes.color&&e&&e.includes("color")){const t=s.attributes.position.count,i=new Float32Array(t*4);i.fill(1),s.setAttribute("color",new H(i,4))}}function di(s){let e=0;if(s.byteLength!==0){const t=new Uint8Array(s);for(let i=0;i<s.byteLength;i++){const a=t[i];e=(e<<5)-e+a,e|=0}}return e}function Fi(s){let e=s.uuid;const t=Object.values(s.attributes);s.index&&(t.push(s.index),e+=`index|${s.index.version}`);const i=Object.keys(t).sort();for(const a of i){const n=t[a];e+=`${a}_${n.version}|`}return e}function Di(s){const e=s.skeleton;return e?(e.boneTexture||e.computeBoneTexture(),`${di(e.boneTexture.image.data.buffer)}_${e.boneTexture.uuid}`):null}class ha{constructor(e=null){this.matrixWorld=new L,this.geometryHash=null,this.skeletonHash=null,this.primitiveCount=-1,e!==null&&this.updateFrom(e)}updateFrom(e){const t=e.geometry,i=(t.index?t.index.count:t.attributes.position.count)/3;this.matrixWorld.copy(e.matrixWorld),this.geometryHash=Fi(t),this.primitiveCount=i,this.skeletonHash=Di(e)}didChange(e){const t=e.geometry,i=(t.index?t.index.count:t.attributes.position.count)/3;return!(this.matrixWorld.equals(e.matrixWorld)&&this.geometryHash===Fi(t)&&this.skeletonHash===Di(e)&&this.primitiveCount===i)}}const be=new F,Te=new F,we=new F,Ei=new Le,xt=new F,qt=new F,Bi=new Le,zi=new Le,yt=new L,ki=new L;function Oi(s,e,t){const i=s.skeleton,a=s.geometry,n=i.bones,r=i.boneInverses;Bi.fromBufferAttribute(a.attributes.skinIndex,e),zi.fromBufferAttribute(a.attributes.skinWeight,e),yt.elements.fill(0);for(let c=0;c<4;c++){const l=zi.getComponent(c);if(l!==0){const h=Bi.getComponent(c);ki.multiplyMatrices(n[h].matrixWorld,r[h]),da(yt,ki,l)}}return yt.multiply(s.bindMatrix).premultiply(s.bindMatrixInverse),t.transformDirection(yt),t}function Gt(s,e,t,i,a){xt.set(0,0,0);for(let n=0,r=s.length;n<r;n++){const c=e[n],l=s[n];c!==0&&(qt.fromBufferAttribute(l,i),t?xt.addScaledVector(qt,c):xt.addScaledVector(qt.sub(a),c))}a.add(xt)}function da(s,e,t){const i=s.elements,a=e.elements;for(let n=0,r=a.length;n<r;n++)i[n]+=a[n]*t}function ma(s){const{index:e,attributes:t}=s;if(e)for(let i=0,a=e.count;i<a;i+=3){const n=e.getX(i),r=e.getX(i+2);e.setX(i,r),e.setX(i+2,n)}else for(const i in t){const a=t[i],n=a.itemSize;for(let r=0,c=a.count;r<c;r+=3)for(let l=0;l<n;l++){const h=a.getComponent(r,l),f=a.getComponent(r+2,l);a.setComponent(r,l,f),a.setComponent(r+2,l,h)}}return s}function pa(s,e={},t=new ve){e={applyWorldTransforms:!0,attributes:[],...e};const i=s.geometry,a=e.applyWorldTransforms,n=e.attributes.includes("normal"),r=e.attributes.includes("tangent"),c=i.attributes,l=t.attributes;for(const v in t.attributes)(!e.attributes.includes(v)||!(v in i.attributes))&&t.deleteAttribute(v);!t.index&&i.index&&(t.index=i.index.clone()),l.position||t.setAttribute("position",Ze(c.position)),n&&!l.normal&&c.normal&&t.setAttribute("normal",Ze(c.normal)),r&&!l.tangent&&c.tangent&&t.setAttribute("tangent",Ze(c.tangent)),Ne(i.index,t.index),Ne(c.position,l.position),n&&Ne(c.normal,l.normal),r&&Ne(c.tangent,l.tangent);const h=c.position,f=n?c.normal:null,u=r?c.tangent:null,o=i.morphAttributes.position,m=i.morphAttributes.normal,g=i.morphAttributes.tangent,x=i.morphTargetsRelative,d=s.morphTargetInfluences,p=new ar;p.getNormalMatrix(s.matrixWorld),i.index&&t.index.array.set(i.index.array);for(let v=0,y=c.position.count;v<y;v++)be.fromBufferAttribute(h,v),f&&Te.fromBufferAttribute(f,v),u&&(Ei.fromBufferAttribute(u,v),we.fromBufferAttribute(u,v)),d&&(o&&Gt(o,d,x,v,be),m&&Gt(m,d,x,v,Te),g&&Gt(g,d,x,v,we)),s.isSkinnedMesh&&(s.applyBoneTransform(v,be),f&&Oi(s,v,Te),u&&Oi(s,v,we)),a&&be.applyMatrix4(s.matrixWorld),l.position.setXYZ(v,be.x,be.y,be.z),f&&(a&&Te.applyNormalMatrix(p),l.normal.setXYZ(v,Te.x,Te.y,Te.z)),u&&(a&&we.transformDirection(s.matrixWorld),l.tangent.setXYZW(v,we.x,we.y,we.z,Ei.w));for(const v in e.attributes){const y=e.attributes[v];y==="position"||y==="tangent"||y==="normal"||!(y in c)||(l[y]||t.setAttribute(y,Ze(c[y])),Ne(c[y],l[y]),br(c[y],l[y]))}return s.matrixWorld.determinant()<0&&ma(t),t}class ga extends ve{constructor(){super(),this.version=0,this.hash=null,this._diff=new ha}isCompatible(e,t){const i=e.geometry;for(let a=0;a<t.length;a++){const n=t[a],r=i.attributes[n],c=this.attributes[n];if(r&&!Ne(r,c))return!1}return!0}updateFrom(e,t){const i=this._diff;return i.didChange(e)?(pa(e,t,this),i.updateFrom(e),this.version++,this.hash=`${this.uuid}_${this.version}`,!0):!1}}const ni=0,Tr=1,wr=2;function va(s,e){for(let t=0,i=s.length;t<i;t++)s[t].traverseVisible(n=>{n.isMesh&&e(n)})}function xa(s){const e=[];for(let t=0,i=s.length;t<i;t++){const a=s[t];Array.isArray(a.material)?e.push(...a.material):e.push(a.material)}return e}function ya(s,e,t){if(s.length===0){e.setIndex(null);const i=e.attributes;for(const a in i)e.deleteAttribute(a);for(const a in t.attributes)e.setAttribute(t.attributes[a],new H(new Float32Array(0),4,!1))}else la(s,t,e);for(const i in e.attributes)e.attributes[i].needsUpdate=!0}class ba{constructor(e){this.objects=null,this.useGroups=!0,this.applyWorldTransforms=!0,this.generateMissingAttributes=!0,this.overwriteIndex=!0,this.attributes=["position","normal","color","tangent","uv","uv2"],this._intermediateGeometry=new Map,this._geometryMergeSets=new WeakMap,this._mergeOrder=[],this._dummyMesh=null,this.setObjects(e||[])}_getDummyMesh(){if(!this._dummyMesh){const e=new zr,t=new ve;t.setAttribute("position",new H(new Float32Array(9),3)),this._dummyMesh=new nr(t,e)}return this._dummyMesh}_getMeshes(){const e=[];return va(this.objects,t=>{e.push(t)}),e.sort((t,i)=>t.uuid>i.uuid?1:t.uuid<i.uuid?-1:0),e.length===0&&e.push(this._getDummyMesh()),e}_updateIntermediateGeometries(){const{_intermediateGeometry:e}=this,t=this._getMeshes(),i=new Set(e.keys()),a={attributes:this.attributes,applyWorldTransforms:this.applyWorldTransforms};for(let n=0,r=t.length;n<r;n++){const c=t[n],l=c.uuid;i.delete(l);let h=e.get(l);(!h||!h.isCompatible(c,this.attributes))&&(h&&h.dispose(),h=new ga,e.set(l,h)),h.updateFrom(c,a)&&this.generateMissingAttributes&&fa(h,this.attributes)}i.forEach(n=>{e.delete(n)})}setObjects(e){Array.isArray(e)?this.objects=[...e]:this.objects=[e]}generate(e=new ve){const{useGroups:t,overwriteIndex:i,_intermediateGeometry:a,_geometryMergeSets:n}=this,r=this._getMeshes(),c=[],l=[],h=n.get(e)||[];this._updateIntermediateGeometries();let f=!1;r.length!==h.length&&(f=!0);for(let o=0,m=r.length;o<m;o++){const g=r[o],x=a.get(g.uuid);l.push(x);const d=h[o];!d||d.uuid!==x.uuid?(c.push(!1),f=!0):d.version!==x.version?c.push(!1):c.push(!0)}ya(l,e,{useGroups:t,forceUpdate:f,skipAssigningAttributes:c,overwriteIndex:i}),f&&e.dispose(),n.set(e,l.map(o=>({version:o.version,uuid:o.uuid})));let u=ni;return f?u=wr:c.includes(!1)&&(u=Tr),{changeType:u,materials:xa(r),geometry:e}}}function Ta(s){const e=new Set;for(let t=0,i=s.length;t<i;t++){const a=s[t];for(const n in a){const r=a[n];r&&r.isTexture&&e.add(r)}}return Array.from(e)}function wa(s){const e=[],t=new Set;for(let a=0,n=s.length;a<n;a++)s[a].traverse(r=>{r.visible&&(r.isRectAreaLight||r.isSpotLight||r.isPointLight||r.isDirectionalLight)&&(e.push(r),r.iesMap&&t.add(r.iesMap))});const i=Array.from(t).sort((a,n)=>a.uuid<n.uuid?1:a.uuid>n.uuid?-1:0);return{lights:e,iesTextures:i}}class Sa{get initialized(){return!!this.bvh}constructor(e){this.bvhOptions={},this.attributes=["position","normal","tangent","color","uv","uv2"],this.generateBVH=!0,this.bvh=null,this.geometry=new ve,this.staticGeometryGenerator=new ba(e),this._bvhWorker=null,this._pendingGenerate=null,this._buildAsync=!1}setObjects(e){this.staticGeometryGenerator.setObjects(e)}setBVHWorker(e){this._bvhWorker=e}async generateAsync(e=null){if(!this._bvhWorker)throw new Error('PathTracingSceneGenerator: "setBVHWorker" must be called before "generateAsync" can be called.');if(this.bvh instanceof Promise)return this._pendingGenerate||(this._pendingGenerate=new Promise(async()=>(await this.bvh,this._pendingGenerate=null,this.generateAsync(e)))),this._pendingGenerate;{this._buildAsync=!0;const t=this.generate(e);return this._buildAsync=!1,t.bvh=this.bvh=await t.bvh,t}}generate(e=null){const{staticGeometryGenerator:t,geometry:i,attributes:a}=this,n=t.objects;t.attributes=a,n.forEach(u=>{u.traverse(o=>{o.isSkinnedMesh&&o.skeleton&&o.skeleton.update()})});const r=t.generate(i),c=r.materials,l=Ta(c),{lights:h,iesTextures:f}=wa(n);if(r.changeType!==ni&&ua(i,c,c),this.generateBVH){if(this.bvh instanceof Promise)throw new Error("PathTracingSceneGenerator: BVH is already building asynchronously.");if(r.changeType===wr){const u={strategy:ur,maxLeafTris:1,indirect:!0,onProgress:e,...this.bvhOptions};this._buildAsync?this.bvh=this._bvhWorker.generate(i,u):this.bvh=new hi(i,u)}else r.changeType===Tr&&this.bvh.refit()}return{bvhChanged:r.changeType!==ni,bvh:this.bvh,lights:h,iesTextures:f,geometry:i,materials:c,textures:l,objects:n}}}class mi extends rt{set needsUpdate(e){super.needsUpdate=!0,this.dispatchEvent({type:"recompilation"})}constructor(e){super(e);for(const t in this.uniforms)Object.defineProperty(this,t,{get(){return this.uniforms[t].value},set(i){this.uniforms[t].value=i}})}setDefine(e,t=void 0){if(t==null){if(e in this.defines)return delete this.defines[e],this.needsUpdate=!0,!0}else if(this.defines[e]!==t)return this.defines[e]=t,this.needsUpdate=!0,!0;return!1}}class _a extends mi{constructor(e){super({blending:it,uniforms:{target1:{value:null},target2:{value:null},opacity:{value:1}},vertexShader:`

				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`,fragmentShader:`

				uniform float opacity;

				uniform sampler2D target1;
				uniform sampler2D target2;

				varying vec2 vUv;

				void main() {

					vec4 color1 = texture2D( target1, vUv );
					vec4 color2 = texture2D( target2, vUv );

					float invOpacity = 1.0 - opacity;
					float totalAlpha = color1.a * invOpacity + color2.a * opacity;

					if ( color1.a != 0.0 || color2.a != 0.0 ) {

						gl_FragColor.rgb = color1.rgb * ( invOpacity * color1.a / totalAlpha ) + color2.rgb * ( opacity * color2.a / totalAlpha );
						gl_FragColor.a = totalAlpha;

					} else {

						gl_FragColor = vec4( 0.0 );

					}

				}`}),this.setValues(e)}}function bt(s=1){let e="uint";return s>1&&(e="uvec"+s),`
		${e} sobolReverseBits( ${e} x ) {

			x = ( ( ( x & 0xaaaaaaaau ) >> 1 ) | ( ( x & 0x55555555u ) << 1 ) );
			x = ( ( ( x & 0xccccccccu ) >> 2 ) | ( ( x & 0x33333333u ) << 2 ) );
			x = ( ( ( x & 0xf0f0f0f0u ) >> 4 ) | ( ( x & 0x0f0f0f0fu ) << 4 ) );
			x = ( ( ( x & 0xff00ff00u ) >> 8 ) | ( ( x & 0x00ff00ffu ) << 8 ) );
			return ( ( x >> 16 ) | ( x << 16 ) );

		}

		${e} sobolHashCombine( uint seed, ${e} v ) {

			return seed ^ ( v + ${e}( ( seed << 6 ) + ( seed >> 2 ) ) );

		}

		${e} sobolLaineKarrasPermutation( ${e} x, ${e} seed ) {

			x += seed;
			x ^= x * 0x6c50b47cu;
			x ^= x * 0xb82f1e52u;
			x ^= x * 0xc7afe638u;
			x ^= x * 0x8d22f6e6u;
			return x;

		}

		${e} nestedUniformScrambleBase2( ${e} x, ${e} seed ) {

			x = sobolLaineKarrasPermutation( x, seed );
			x = sobolReverseBits( x );
			return x;

		}
	`}function Tt(s=1){let e="uint",t="float",i="",a=".r",n="1u";return s>1&&(e="uvec"+s,t="vec"+s,i=s+"",s===2?(a=".rg",n="uvec2( 1u, 2u )"):s===3?(a=".rgb",n="uvec3( 1u, 2u, 3u )"):(a="",n="uvec4( 1u, 2u, 3u, 4u )")),`

		${t} sobol${i}( int effect ) {

			uint seed = sobolGetSeed( sobolBounceIndex, uint( effect ) );
			uint index = sobolPathIndex;

			uint shuffle_seed = sobolHashCombine( seed, 0u );
			uint shuffled_index = nestedUniformScrambleBase2( sobolReverseBits( index ), shuffle_seed );
			${t} sobol_pt = sobolGetTexturePoint( shuffled_index )${a};
			${e} result = ${e}( sobol_pt * 16777216.0 );

			${e} seed2 = sobolHashCombine( seed, ${n} );
			result = nestedUniformScrambleBase2( result, seed2 );

			return SOBOL_FACTOR * ${t}( result >> 8 );

		}
	`}const Sr=`

	// Utils
	const float SOBOL_FACTOR = 1.0 / 16777216.0;
	const uint SOBOL_MAX_POINTS = 256u * 256u;

	${bt(1)}
	${bt(2)}
	${bt(3)}
	${bt(4)}

	uint sobolHash( uint x ) {

		// finalizer from murmurhash3
		x ^= x >> 16;
		x *= 0x85ebca6bu;
		x ^= x >> 13;
		x *= 0xc2b2ae35u;
		x ^= x >> 16;
		return x;

	}

`,Aa=`

	const uint SOBOL_DIRECTIONS_1[ 32 ] = uint[ 32 ](
		0x80000000u, 0xc0000000u, 0xa0000000u, 0xf0000000u,
		0x88000000u, 0xcc000000u, 0xaa000000u, 0xff000000u,
		0x80800000u, 0xc0c00000u, 0xa0a00000u, 0xf0f00000u,
		0x88880000u, 0xcccc0000u, 0xaaaa0000u, 0xffff0000u,
		0x80008000u, 0xc000c000u, 0xa000a000u, 0xf000f000u,
		0x88008800u, 0xcc00cc00u, 0xaa00aa00u, 0xff00ff00u,
		0x80808080u, 0xc0c0c0c0u, 0xa0a0a0a0u, 0xf0f0f0f0u,
		0x88888888u, 0xccccccccu, 0xaaaaaaaau, 0xffffffffu
	);

	const uint SOBOL_DIRECTIONS_2[ 32 ] = uint[ 32 ](
		0x80000000u, 0xc0000000u, 0x60000000u, 0x90000000u,
		0xe8000000u, 0x5c000000u, 0x8e000000u, 0xc5000000u,
		0x68800000u, 0x9cc00000u, 0xee600000u, 0x55900000u,
		0x80680000u, 0xc09c0000u, 0x60ee0000u, 0x90550000u,
		0xe8808000u, 0x5cc0c000u, 0x8e606000u, 0xc5909000u,
		0x6868e800u, 0x9c9c5c00u, 0xeeee8e00u, 0x5555c500u,
		0x8000e880u, 0xc0005cc0u, 0x60008e60u, 0x9000c590u,
		0xe8006868u, 0x5c009c9cu, 0x8e00eeeeu, 0xc5005555u
	);

	const uint SOBOL_DIRECTIONS_3[ 32 ] = uint[ 32 ](
		0x80000000u, 0xc0000000u, 0x20000000u, 0x50000000u,
		0xf8000000u, 0x74000000u, 0xa2000000u, 0x93000000u,
		0xd8800000u, 0x25400000u, 0x59e00000u, 0xe6d00000u,
		0x78080000u, 0xb40c0000u, 0x82020000u, 0xc3050000u,
		0x208f8000u, 0x51474000u, 0xfbea2000u, 0x75d93000u,
		0xa0858800u, 0x914e5400u, 0xdbe79e00u, 0x25db6d00u,
		0x58800080u, 0xe54000c0u, 0x79e00020u, 0xb6d00050u,
		0x800800f8u, 0xc00c0074u, 0x200200a2u, 0x50050093u
	);

	const uint SOBOL_DIRECTIONS_4[ 32 ] = uint[ 32 ](
		0x80000000u, 0x40000000u, 0x20000000u, 0xb0000000u,
		0xf8000000u, 0xdc000000u, 0x7a000000u, 0x9d000000u,
		0x5a800000u, 0x2fc00000u, 0xa1600000u, 0xf0b00000u,
		0xda880000u, 0x6fc40000u, 0x81620000u, 0x40bb0000u,
		0x22878000u, 0xb3c9c000u, 0xfb65a000u, 0xddb2d000u,
		0x78022800u, 0x9c0b3c00u, 0x5a0fb600u, 0x2d0ddb00u,
		0xa2878080u, 0xf3c9c040u, 0xdb65a020u, 0x6db2d0b0u,
		0x800228f8u, 0x400b3cdcu, 0x200fb67au, 0xb00ddb9du
	);

	uint getMaskedSobol( uint index, uint directions[ 32 ] ) {

		uint X = 0u;
		for ( int bit = 0; bit < 32; bit ++ ) {

			uint mask = ( index >> bit ) & 1u;
			X ^= mask * directions[ bit ];

		}
		return X;

	}

	vec4 generateSobolPoint( uint index ) {

		if ( index >= SOBOL_MAX_POINTS ) {

			return vec4( 0.0 );

		}

		// NOTE: this sobol "direction" is also available but we can't write out 5 components
		// uint x = index & 0x00ffffffu;
		uint x = sobolReverseBits( getMaskedSobol( index, SOBOL_DIRECTIONS_1 ) ) & 0x00ffffffu;
		uint y = sobolReverseBits( getMaskedSobol( index, SOBOL_DIRECTIONS_2 ) ) & 0x00ffffffu;
		uint z = sobolReverseBits( getMaskedSobol( index, SOBOL_DIRECTIONS_3 ) ) & 0x00ffffffu;
		uint w = sobolReverseBits( getMaskedSobol( index, SOBOL_DIRECTIONS_4 ) ) & 0x00ffffffu;

		return vec4( x, y, z, w ) * SOBOL_FACTOR;

	}

`,Ma=`

	// Seeds
	uniform sampler2D sobolTexture;
	uint sobolPixelIndex = 0u;
	uint sobolPathIndex = 0u;
	uint sobolBounceIndex = 0u;

	uint sobolGetSeed( uint bounce, uint effect ) {

		return sobolHash(
			sobolHashCombine(
				sobolHashCombine(
					sobolHash( bounce ),
					sobolPixelIndex
				),
				effect
			)
		);

	}

	vec4 sobolGetTexturePoint( uint index ) {

		if ( index >= SOBOL_MAX_POINTS ) {

			index = index % SOBOL_MAX_POINTS;

		}

		uvec2 dim = uvec2( textureSize( sobolTexture, 0 ).xy );
		uint y = index / dim.x;
		uint x = index - y * dim.x;
		vec2 uv = vec2( x, y ) / vec2( dim );
		return texture( sobolTexture, uv );

	}

	${Tt(1)}
	${Tt(2)}
	${Tt(3)}
	${Tt(4)}

`;class Ia extends mi{constructor(){super({blending:it,uniforms:{resolution:{value:new Y}},vertexShader:`

				varying vec2 vUv;
				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}
			`,fragmentShader:`

				${Sr}
				${Aa}

				varying vec2 vUv;
				uniform vec2 resolution;
				void main() {

					uint index = uint( gl_FragCoord.y ) * uint( resolution.x ) + uint( gl_FragCoord.x );
					gl_FragColor = generateSobolPoint( index );

				}
			`})}}class Ra{generate(e,t=256){const i=new et(t,t,{type:V,format:U,minFilter:O,magFilter:O,generateMipmaps:!1}),a=e.getRenderTarget();e.setRenderTarget(i);const n=new _e(new Ia);return n.material.resolution.set(t,t),n.render(e),e.setRenderTarget(a),n.dispose(),i}}class _r extends or{set bokehSize(e){this.fStop=this.getFocalLength()/e}get bokehSize(){return this.getFocalLength()/this.fStop}constructor(...e){super(...e),this.fStop=1.4,this.apertureBlades=0,this.apertureRotation=0,this.focusDistance=25,this.anamorphicRatio=1}copy(e,t){return super.copy(e,t),this.fStop=e.fStop,this.apertureBlades=e.apertureBlades,this.apertureRotation=e.apertureRotation,this.focusDistance=e.focusDistance,this.anamorphicRatio=e.anamorphicRatio,this}}class Pa{constructor(){this.bokehSize=0,this.apertureBlades=0,this.apertureRotation=0,this.focusDistance=10,this.anamorphicRatio=1}updateFrom(e){e instanceof _r?(this.bokehSize=e.bokehSize,this.apertureBlades=e.apertureBlades,this.apertureRotation=e.apertureRotation,this.focusDistance=e.focusDistance,this.anamorphicRatio=e.anamorphicRatio):(this.bokehSize=0,this.apertureRotation=0,this.apertureBlades=0,this.focusDistance=10,this.anamorphicRatio=1)}}function $t(s){const e=new Uint16Array(s.length);for(let t=0,i=s.length;t<i;++t)e[t]=ce.toHalfFloat(s[t]);return e}function Ni(s,e,t=0,i=s.length){let a=t,n=t+i-1;for(;a<n;){const r=a+n>>1;s[r]<e?a=r+1:n=r}return a-t}function Ca(s,e,t){return .2126*s+.7152*e+.0722*t}function Fa(s,e=ae){const t=s.clone();t.source=new kr({...t.image});const{width:i,height:a,data:n}=t.image;let r=n;if(t.type!==e){e===ae?r=new Uint16Array(n.length):r=new Float32Array(n.length);let c;n instanceof Int8Array||n instanceof Int16Array||n instanceof Int32Array?c=2**(8*n.BYTES_PER_ELEMENT-1)-1:c=2**(8*n.BYTES_PER_ELEMENT)-1;for(let l=0,h=n.length;l<h;l++){let f=n[l];t.type===ae&&(f=ce.fromHalfFloat(n[l])),t.type!==V&&t.type!==ae&&(f/=c),e===ae&&(r[l]=ce.toHalfFloat(f))}t.image.data=r,t.type=e}if(t.flipY){const c=r;r=r.slice();for(let l=0;l<a;l++)for(let h=0;h<i;h++){const f=a-l-1,u=4*(l*i+h),o=4*(f*i+h);r[o+0]=c[u+0],r[o+1]=c[u+1],r[o+2]=c[u+2],r[o+3]=c[u+3]}t.flipY=!1,t.image.data=r}return t}class Da{constructor(){const e=new ee($t(new Float32Array([0,0,0,0])),1,1);e.type=ae,e.format=U,e.minFilter=re,e.magFilter=re,e.wrapS=pe,e.wrapT=pe,e.generateMipmaps=!1,e.needsUpdate=!0;const t=new ee($t(new Float32Array([0,1])),1,2);t.type=ae,t.format=At,t.minFilter=re,t.magFilter=re,t.generateMipmaps=!1,t.needsUpdate=!0;const i=new ee($t(new Float32Array([0,0,1,1])),2,2);i.type=ae,i.format=At,i.minFilter=re,i.magFilter=re,i.generateMipmaps=!1,i.needsUpdate=!0,this.map=e,this.marginalWeights=t,this.conditionalWeights=i,this.totalSum=0}dispose(){this.marginalWeights.dispose(),this.conditionalWeights.dispose(),this.map.dispose()}updateFrom(e){const t=Fa(e);t.wrapS=pe,t.wrapT=xe;const{width:i,height:a,data:n}=t.image,r=new Float32Array(i*a),c=new Float32Array(i*a),l=new Float32Array(a),h=new Float32Array(a);let f=0,u=0;for(let d=0;d<a;d++){let p=0;for(let v=0;v<i;v++){const y=d*i+v,T=ce.fromHalfFloat(n[4*y+0]),b=ce.fromHalfFloat(n[4*y+1]),S=ce.fromHalfFloat(n[4*y+2]),w=Ca(T,b,S);p+=w,f+=w,r[y]=w,c[y]=p}if(p!==0)for(let v=d*i,y=d*i+i;v<y;v++)r[v]/=p,c[v]/=p;u+=p,l[d]=p,h[d]=u}if(u!==0)for(let d=0,p=l.length;d<p;d++)l[d]/=u,h[d]/=u;const o=new Uint16Array(a),m=new Uint16Array(i*a);for(let d=0;d<a;d++){const p=(d+1)/a,v=Ni(h,p);o[d]=ce.toHalfFloat((v+.5)/a)}for(let d=0;d<a;d++)for(let p=0;p<i;p++){const v=d*i+p,y=(p+1)/i,T=Ni(c,y,d*i,i);m[v]=ce.toHalfFloat((T+.5)/i)}this.dispose();const{marginalWeights:g,conditionalWeights:x}=this;g.image={width:a,height:1,data:o},g.needsUpdate=!0,x.image={width:i,height:a,data:m},x.needsUpdate=!0,this.totalSum=f,this.map=t}}const jt=6,Ea=0,Ba=1,za=2,ka=3,Oa=4,te=new F,$=new F,Hi=new L,ze=new Or,Li=new F,ke=new F,Na=new F(0,1,0);class Ha{constructor(){const e=new ee(new Float32Array(4),1,1);e.format=U,e.type=V,e.wrapS=xe,e.wrapT=xe,e.generateMipmaps=!1,e.minFilter=O,e.magFilter=O,this.tex=e,this.count=0}updateFrom(e,t=[]){const i=this.tex,a=Math.max(e.length*jt,1),n=Math.ceil(Math.sqrt(a));i.image.width!==n&&(i.dispose(),i.image.data=new Float32Array(n*n*4),i.image.width=n,i.image.height=n);const r=i.image.data;for(let l=0,h=e.length;l<h;l++){const f=e[l],u=l*jt*4;let o=0;for(let g=0;g<jt*4;g++)r[u+g]=0;f.getWorldPosition($),r[u+o++]=$.x,r[u+o++]=$.y,r[u+o++]=$.z;let m=Ea;if(f.isRectAreaLight&&f.isCircular?m=Ba:f.isSpotLight?m=za:f.isDirectionalLight?m=ka:f.isPointLight&&(m=Oa),r[u+o++]=m,r[u+o++]=f.color.r,r[u+o++]=f.color.g,r[u+o++]=f.color.b,r[u+o++]=f.intensity,f.getWorldQuaternion(ze),f.isRectAreaLight)te.set(f.width,0,0).applyQuaternion(ze),r[u+o++]=te.x,r[u+o++]=te.y,r[u+o++]=te.z,o++,$.set(0,f.height,0).applyQuaternion(ze),r[u+o++]=$.x,r[u+o++]=$.y,r[u+o++]=$.z,r[u+o++]=te.cross($).length()*(f.isCircular?Math.PI/4:1);else if(f.isSpotLight){const g=f.radius||0;Li.setFromMatrixPosition(f.matrixWorld),ke.setFromMatrixPosition(f.target.matrixWorld),Hi.lookAt(Li,ke,Na),ze.setFromRotationMatrix(Hi),te.set(1,0,0).applyQuaternion(ze),r[u+o++]=te.x,r[u+o++]=te.y,r[u+o++]=te.z,o++,$.set(0,1,0).applyQuaternion(ze),r[u+o++]=$.x,r[u+o++]=$.y,r[u+o++]=$.z,r[u+o++]=Math.PI*g*g,r[u+o++]=g,r[u+o++]=f.decay,r[u+o++]=f.distance,r[u+o++]=Math.cos(f.angle),r[u+o++]=Math.cos(f.angle*(1-f.penumbra)),r[u+o++]=f.iesMap?t.indexOf(f.iesMap):-1}else if(f.isPointLight){const g=te.setFromMatrixPosition(f.matrixWorld);r[u+o++]=g.x,r[u+o++]=g.y,r[u+o++]=g.z,o++,o+=4,o+=1,r[u+o++]=f.decay,r[u+o++]=f.distance}else if(f.isDirectionalLight){const g=te.setFromMatrixPosition(f.matrixWorld),x=$.setFromMatrixPosition(f.target.matrixWorld);ke.subVectors(g,x).normalize(),r[u+o++]=ke.x,r[u+o++]=ke.y,r[u+o++]=ke.z}}this.count=e.length;const c=di(r.buffer);return this.hash!==c?(this.hash=c,i.needsUpdate=!0,!0):!1}}function Ui(s,e,t,i,a){if(e>i)throw new Error;const n=s.length/e,r=s.constructor.BYTES_PER_ELEMENT*8;let c=1;switch(s.constructor){case Uint8Array:case Uint16Array:case Uint32Array:c=2**r-1;break;case Int8Array:case Int16Array:case Int32Array:c=2**(r-1)-1;break}for(let l=0;l<n;l++){const h=4*l,f=e*l;for(let u=0;u<i;u++)t[a+h+u]=e>=u+1?s[f+u]/c:0}}class La extends Nr{constructor(){super(),this._textures=[],this.type=V,this.format=U,this.internalFormat="RGBA32F"}updateAttribute(e,t){const i=this._textures[e];i.updateFrom(t);const a=i.image,n=this.image;if(a.width!==n.width||a.height!==n.height)throw new Error("FloatAttributeTextureArray: Attribute must be the same dimensions when updating single layer.");const{width:r,height:c,data:l}=n,f=r*c*4*e;let u=t.itemSize;u===3&&(u=4),Ui(i.image.data,u,l,4,f),this.dispose(),this.needsUpdate=!0}setAttributes(e){const t=e[0].count,i=e.length;for(let u=0,o=i;u<o;u++)if(e[u].count!==t)throw new Error("FloatAttributeTextureArray: All attributes must have the same item count.");const a=this._textures;for(;a.length<i;){const u=new yr;a.push(u)}for(;a.length>i;)a.pop();for(let u=0,o=i;u<o;u++)a[u].updateFrom(e[u]);const r=a[0].image,c=this.image;(r.width!==c.width||r.height!==c.height||r.depth!==i)&&(c.width=r.width,c.height=r.height,c.depth=i,c.data=new Float32Array(c.width*c.height*c.depth*4));const{data:l,width:h,height:f}=c;for(let u=0,o=i;u<o;u++){const m=a[u],x=h*f*4*u;let d=e[u].itemSize;d===3&&(d=4),Ui(m.image.data,d,l,4,x)}this.dispose(),this.needsUpdate=!0}}class Ua extends La{updateNormalAttribute(e){this.updateAttribute(0,e)}updateTangentAttribute(e){this.updateAttribute(1,e)}updateUvAttribute(e){this.updateAttribute(2,e)}updateColorAttribute(e){this.updateAttribute(3,e)}updateFrom(e,t,i,a){this.setAttributes([e,t,i,a])}}function pi(s,e){return s.uuid<e.uuid?1:s.uuid>e.uuid?-1:0}function oi(s){return`${s.source.uuid}:${s.colorSpace}`}function Wa(s){const e=new Set,t=[];for(let i=0,a=s.length;i<a;i++){const n=s[i],r=oi(n);e.has(r)||(e.add(r),t.push(n))}return t}function Va(s){const e=s.map(i=>i.iesMap||null).filter(i=>i),t=new Set(e);return Array.from(t).sort(pi)}function qa(s){const e=new Set;for(let i=0,a=s.length;i<a;i++){const n=s[i];for(const r in n){const c=n[r];c&&c.isTexture&&e.add(c)}}const t=Array.from(e);return Wa(t).sort(pi)}function Ga(s){const e=[];return s.traverse(t=>{t.visible&&(t.isRectAreaLight||t.isSpotLight||t.isPointLight||t.isDirectionalLight)&&e.push(t)}),e.sort(pi)}const Ar=45,Wi=Ar*4;class $a{constructor(){this._features={}}isUsed(e){return e in this._features}setUsed(e,t=!0){t===!1?delete this._features[e]:this._features[e]=!0}reset(){this._features={}}}class ja extends ee{constructor(){super(new Float32Array(4),1,1),this.format=U,this.type=V,this.wrapS=xe,this.wrapT=xe,this.minFilter=O,this.magFilter=O,this.generateMipmaps=!1,this.features=new $a}updateFrom(e,t){function i(g,x,d=-1){if(x in g&&g[x]){const p=oi(g[x]);return u[p]}else return d}function a(g,x,d){return x in g?g[x]:d}function n(g,x,d,p){const v=g[x]&&g[x].isTexture?g[x]:null;if(v){v.matrixAutoUpdate&&v.updateMatrix();const y=v.matrix.elements;let T=0;d[p+T++]=y[0],d[p+T++]=y[3],d[p+T++]=y[6],T++,d[p+T++]=y[1],d[p+T++]=y[4],d[p+T++]=y[7],T++}return 8}let r=0;const c=e.length*Ar,l=Math.ceil(Math.sqrt(c))||1,{image:h,features:f}=this,u={};for(let g=0,x=t.length;g<x;g++)u[oi(t[g])]=g;h.width!==l&&(this.dispose(),h.data=new Float32Array(l*l*4),h.width=l,h.height=l);const o=h.data;f.reset();for(let g=0,x=e.length;g<x;g++){const d=e[g];if(d.isFogVolumeMaterial){f.setUsed("FOG");for(let y=0;y<Wi;y++)o[r+y]=0;o[r+0+0]=d.color.r,o[r+0+1]=d.color.g,o[r+0+2]=d.color.b,o[r+8+3]=a(d,"emissiveIntensity",0),o[r+12+0]=d.emissive.r,o[r+12+1]=d.emissive.g,o[r+12+2]=d.emissive.b,o[r+52+1]=d.density,o[r+52+3]=0,o[r+56+2]=4,r+=Wi;continue}o[r++]=d.color.r,o[r++]=d.color.g,o[r++]=d.color.b,o[r++]=i(d,"map"),o[r++]=a(d,"metalness",0),o[r++]=i(d,"metalnessMap"),o[r++]=a(d,"roughness",0),o[r++]=i(d,"roughnessMap"),o[r++]=a(d,"ior",1.5),o[r++]=a(d,"transmission",0),o[r++]=i(d,"transmissionMap"),o[r++]=a(d,"emissiveIntensity",0),"emissive"in d?(o[r++]=d.emissive.r,o[r++]=d.emissive.g,o[r++]=d.emissive.b):(o[r++]=0,o[r++]=0,o[r++]=0),o[r++]=i(d,"emissiveMap"),o[r++]=i(d,"normalMap"),"normalScale"in d?(o[r++]=d.normalScale.x,o[r++]=d.normalScale.y):(o[r++]=1,o[r++]=1),o[r++]=a(d,"clearcoat",0),o[r++]=i(d,"clearcoatMap"),o[r++]=a(d,"clearcoatRoughness",0),o[r++]=i(d,"clearcoatRoughnessMap"),o[r++]=i(d,"clearcoatNormalMap"),"clearcoatNormalScale"in d?(o[r++]=d.clearcoatNormalScale.x,o[r++]=d.clearcoatNormalScale.y):(o[r++]=1,o[r++]=1),r++,o[r++]=a(d,"sheen",0),"sheenColor"in d?(o[r++]=d.sheenColor.r,o[r++]=d.sheenColor.g,o[r++]=d.sheenColor.b):(o[r++]=0,o[r++]=0,o[r++]=0),o[r++]=i(d,"sheenColorMap"),o[r++]=a(d,"sheenRoughness",0),o[r++]=i(d,"sheenRoughnessMap"),o[r++]=i(d,"iridescenceMap"),o[r++]=i(d,"iridescenceThicknessMap"),o[r++]=a(d,"iridescence",0),o[r++]=a(d,"iridescenceIOR",1.3);const p=a(d,"iridescenceThicknessRange",[100,400]);o[r++]=p[0],o[r++]=p[1],"specularColor"in d?(o[r++]=d.specularColor.r,o[r++]=d.specularColor.g,o[r++]=d.specularColor.b):(o[r++]=1,o[r++]=1,o[r++]=1),o[r++]=i(d,"specularColorMap"),o[r++]=a(d,"specularIntensity",1),o[r++]=i(d,"specularIntensityMap");const v=a(d,"thickness",0)===0&&a(d,"attenuationDistance",1/0)===1/0;if(o[r++]=Number(v),r++,"attenuationColor"in d?(o[r++]=d.attenuationColor.r,o[r++]=d.attenuationColor.g,o[r++]=d.attenuationColor.b):(o[r++]=1,o[r++]=1,o[r++]=1),o[r++]=a(d,"attenuationDistance",1/0),o[r++]=i(d,"alphaMap"),o[r++]=d.opacity,o[r++]=d.alphaTest,!v&&d.transmission>0)o[r++]=0;else switch(d.side){case Yt:o[r++]=1;break;case tr:o[r++]=-1;break;case ir:o[r++]=0;break}o[r++]=Number(a(d,"matte",!1)),o[r++]=Number(a(d,"castShadow",!0)),o[r++]=Number(d.vertexColors)|Number(d.flatShading)<<1,o[r++]=Number(d.transparent),r+=n(d,"map",o,r),r+=n(d,"metalnessMap",o,r),r+=n(d,"roughnessMap",o,r),r+=n(d,"transmissionMap",o,r),r+=n(d,"emissiveMap",o,r),r+=n(d,"normalMap",o,r),r+=n(d,"clearcoatMap",o,r),r+=n(d,"clearcoatNormalMap",o,r),r+=n(d,"clearcoatRoughnessMap",o,r),r+=n(d,"sheenColorMap",o,r),r+=n(d,"sheenRoughnessMap",o,r),r+=n(d,"iridescenceMap",o,r),r+=n(d,"iridescenceThicknessMap",o,r),r+=n(d,"specularColorMap",o,r),r+=n(d,"specularIntensityMap",o,r)}const m=di(o.buffer);return this.hash!==m?(this.hash=m,this.needsUpdate=!0,!0):!1}}const Vi=new Ue;function Ya(s){return s?`${s.uuid}:${s.version}`:null}function Xa(s,e){for(const t in e)t in s&&(s[t]=e[t])}class qi extends Hr{constructor(e,t,i){const a={format:U,type:Xt,minFilter:re,magFilter:re,wrapS:pe,wrapT:pe,generateMipmaps:!1,...i};super(e,t,1,a),Xa(this.texture,a),this.texture.setTextures=(...r)=>{this.setTextures(...r)},this.hashes=[null];const n=new _e(new Qa);this.fsQuad=n}setTextures(e,t,i=this.width,a=this.height){const n=e.getRenderTarget(),r=e.toneMapping,c=e.getClearAlpha();e.getClearColor(Vi);const l=t.length||1;(i!==this.width||a!==this.height||this.depth!==l)&&(this.setSize(i,a,l),this.hashes=new Array(l).fill(null)),e.setClearColor(0,0),e.toneMapping=Lr;const h=this.fsQuad,f=this.hashes;let u=!1;for(let o=0,m=l;o<m;o++){const g=t[o],x=Ya(g);g&&(f[o]!==x||g.isWebGLRenderTarget)&&(g.matrixAutoUpdate=!1,g.matrix.identity(),h.material.map=g,e.setRenderTarget(this,o),h.render(e),g.updateMatrix(),g.matrixAutoUpdate=!0,f[o]=x,u=!0)}return h.material.map=null,e.setClearColor(Vi,c),e.setRenderTarget(n),e.toneMapping=r,u}dispose(){super.dispose(),this.fsQuad.dispose()}}class Qa extends rt{get map(){return this.uniforms.map.value}set map(e){this.uniforms.map.value=e}constructor(){super({uniforms:{map:{value:null}},vertexShader:`
				varying vec2 vUv;
				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}
			`,fragmentShader:`
				uniform sampler2D map;
				varying vec2 vUv;
				void main() {

					gl_FragColor = texture2D( map, vUv );

				}
			`})}}function Ka(s,e=Math.random()){for(let t=s.length-1;t>0;t--){const i=Math.floor(e()*(t+1)),a=s[t];s[t]=s[i],s[i]=a}return s}class Za{constructor(e,t,i=Math.random){const a=e**t,n=new Uint16Array(a);let r=a;for(let c=0;c<a;c++)n[c]=c;this.samples=new Float32Array(t),this.strataCount=e,this.reset=function(){for(let c=0;c<a;c++)n[c]=c;r=0},this.reshuffle=function(){r=0},this.next=function(){const{samples:c}=this;r>=n.length&&(Ka(n,i),this.reshuffle());let l=n[r++];for(let h=0;h<t;h++)c[h]=(l%e+i())/e,l=Math.floor(l/e);return c}}}class Ja{constructor(e,t,i=Math.random){let a=0;for(const l of t)a+=l;const n=new Float32Array(a),r=[];let c=0;for(const l of t){const h=new Za(e,l,i);h.samples=new Float32Array(n.buffer,c,h.samples.length),c+=h.samples.length*4,r.push(h)}this.samples=n,this.strataCount=e,this.next=function(){for(const l of r)l.next();return n},this.reshuffle=function(){for(const l of r)l.reshuffle()},this.reset=function(){for(const l of r)l.reset()}}}class en{constructor(e=0){this.m=2147483648,this.a=1103515245,this.c=12345,this.seed=e}nextInt(){return this.seed=(this.a*this.seed+this.c)%this.m,this.seed}nextFloat(){return this.nextInt()/(this.m-1)}}class tn extends ee{constructor(e=1,t=1,i=8){super(new Float32Array(1),1,1,U,V),this.minFilter=O,this.magFilter=O,this.strata=i,this.sampler=null,this.generator=new en,this.stableNoise=!1,this.random=()=>this.stableNoise?this.generator.nextFloat():Math.random(),this.init(e,t,i)}init(e=this.image.height,t=this.image.width,i=this.strata){const{image:a}=this;if(a.width===t&&a.height===e&&this.sampler!==null)return;const n=new Array(e*t).fill(4),r=new Ja(i,n,this.random);a.width=t,a.height=e,a.data=r.samples,this.sampler=r,this.dispose(),this.next()}next(){this.sampler.next(),this.needsUpdate=!0}reset(){this.sampler.reset(),this.generator.seed=0}}function rn(s,e=Math.random){for(let t=s.length-1;t>0;t--){const i=~~((e()-1e-6)*t),a=s[t];s[t]=s[i],s[i]=a}}function sn(s,e){s.fill(0);for(let t=0;t<e;t++)s[t]=1}class Gi{constructor(e){this.count=0,this.size=-1,this.sigma=-1,this.radius=-1,this.lookupTable=null,this.score=null,this.binaryPattern=null,this.resize(e),this.setSigma(1.5)}findVoid(){const{score:e,binaryPattern:t}=this;let i=1/0,a=-1;for(let n=0,r=t.length;n<r;n++){if(t[n]!==0)continue;const c=e[n];c<i&&(i=c,a=n)}return a}findCluster(){const{score:e,binaryPattern:t}=this;let i=-1/0,a=-1;for(let n=0,r=t.length;n<r;n++){if(t[n]!==1)continue;const c=e[n];c>i&&(i=c,a=n)}return a}setSigma(e){if(e===this.sigma)return;const t=~~(Math.sqrt(20*e**2)+1),i=2*t+1,a=new Float32Array(i*i),n=e*e;for(let r=-t;r<=t;r++)for(let c=-t;c<=t;c++){const l=(t+c)*i+r+t,h=r*r+c*c;a[l]=Math.E**(-h/(2*n))}this.lookupTable=a,this.sigma=e,this.radius=t}resize(e){this.size!==e&&(this.size=e,this.score=new Float32Array(e*e),this.binaryPattern=new Uint8Array(e*e))}invert(){const{binaryPattern:e,score:t,size:i}=this;t.fill(0);for(let a=0,n=e.length;a<n;a++)if(e[a]===0){const r=~~(a/i),c=a-r*i;this.updateScore(c,r,1),e[a]=1}else e[a]=0}updateScore(e,t,i){const{size:a,score:n,lookupTable:r}=this,c=this.radius,l=2*c+1;for(let h=-c;h<=c;h++)for(let f=-c;f<=c;f++){const u=(c+f)*l+h+c,o=r[u];let m=e+h;m=m<0?a+m:m%a;let g=t+f;g=g<0?a+g:g%a;const x=g*a+m;n[x]+=i*o}}addPointIndex(e){this.binaryPattern[e]=1;const t=this.size,i=~~(e/t),a=e-i*t;this.updateScore(a,i,1),this.count++}removePointIndex(e){this.binaryPattern[e]=0;const t=this.size,i=~~(e/t),a=e-i*t;this.updateScore(a,i,-1),this.count--}copy(e){this.resize(e.size),this.score.set(e.score),this.binaryPattern.set(e.binaryPattern),this.setSigma(e.sigma),this.count=e.count}}class an{constructor(){this.random=Math.random,this.sigma=1.5,this.size=64,this.majorityPointsRatio=.1,this.samples=new Gi(1),this.savedSamples=new Gi(1)}generate(){const{samples:e,savedSamples:t,sigma:i,majorityPointsRatio:a,size:n}=this;e.resize(n),e.setSigma(i);const r=Math.floor(n*n*a),c=e.binaryPattern;sn(c,r),rn(c,this.random);for(let u=0,o=c.length;u<o;u++)c[u]===1&&e.addPointIndex(u);for(;;){const u=e.findCluster();e.removePointIndex(u);const o=e.findVoid();if(u===o){e.addPointIndex(u);break}e.addPointIndex(o)}const l=new Uint32Array(n*n);t.copy(e);let h;for(h=e.count-1;h>=0;){const u=e.findCluster();e.removePointIndex(u),l[u]=h,h--}const f=n*n;for(h=t.count;h<f/2;){const u=t.findVoid();t.addPointIndex(u),l[u]=h,h++}for(t.invert();h<f;){const u=t.findCluster();t.removePointIndex(u),l[u]=h,h++}return{data:l,maxValue:f}}}function nn(s){return s>=3?4:s}function on(s){switch(s){case 1:return At;case 2:return sr;default:return U}}class cn extends ee{constructor(e=64,t=1){super(new Float32Array(4),1,1,U,V),this.minFilter=O,this.magFilter=O,this.size=e,this.channels=t,this.update()}update(){const e=this.channels,t=this.size,i=new an;i.channels=e,i.size=t;const a=nn(e),n=on(a);(this.image.width!==t||n!==this.format)&&(this.image.width=t,this.image.height=t,this.image.data=new Float32Array(t**2*a),this.format=n,this.dispose());const r=this.image.data;for(let c=0,l=e;c<l;c++){const h=i.generate(),f=h.data,u=h.maxValue;for(let o=0,m=f.length;o<m;o++){const g=f[o]/u;r[o*a+c]=g}}this.needsUpdate=!0}}const ln=`

	struct PhysicalCamera {

		float focusDistance;
		float anamorphicRatio;
		float bokehSize;
		int apertureBlades;
		float apertureRotation;

	};

`,un=`

	struct EquirectHdrInfo {

		sampler2D marginalWeights;
		sampler2D conditionalWeights;
		sampler2D map;

		float totalSum;

	};

`,fn=`

	#define RECT_AREA_LIGHT_TYPE 0
	#define CIRC_AREA_LIGHT_TYPE 1
	#define SPOT_LIGHT_TYPE 2
	#define DIR_LIGHT_TYPE 3
	#define POINT_LIGHT_TYPE 4

	struct LightsInfo {

		sampler2D tex;
		uint count;

	};

	struct Light {

		vec3 position;
		int type;

		vec3 color;
		float intensity;

		vec3 u;
		vec3 v;
		float area;

		// spot light fields
		float radius;
		float near;
		float decay;
		float distance;
		float coneCos;
		float penumbraCos;
		int iesProfile;

	};

	Light readLightInfo( sampler2D tex, uint index ) {

		uint i = index * 6u;

		vec4 s0 = texelFetch1D( tex, i + 0u );
		vec4 s1 = texelFetch1D( tex, i + 1u );
		vec4 s2 = texelFetch1D( tex, i + 2u );
		vec4 s3 = texelFetch1D( tex, i + 3u );

		Light l;
		l.position = s0.rgb;
		l.type = int( round( s0.a ) );

		l.color = s1.rgb;
		l.intensity = s1.a;

		l.u = s2.rgb;
		l.v = s3.rgb;
		l.area = s3.a;

		if ( l.type == SPOT_LIGHT_TYPE || l.type == POINT_LIGHT_TYPE ) {

			vec4 s4 = texelFetch1D( tex, i + 4u );
			vec4 s5 = texelFetch1D( tex, i + 5u );
			l.radius = s4.r;
			l.decay = s4.g;
			l.distance = s4.b;
			l.coneCos = s4.a;

			l.penumbraCos = s5.r;
			l.iesProfile = int( round( s5.g ) );

		} else {

			l.radius = 0.0;
			l.decay = 0.0;
			l.distance = 0.0;

			l.coneCos = 0.0;
			l.penumbraCos = 0.0;
			l.iesProfile = - 1;

		}

		return l;

	}

`,hn=`

	struct Material {

		vec3 color;
		int map;

		float metalness;
		int metalnessMap;

		float roughness;
		int roughnessMap;

		float ior;
		float transmission;
		int transmissionMap;

		float emissiveIntensity;
		vec3 emissive;
		int emissiveMap;

		int normalMap;
		vec2 normalScale;

		float clearcoat;
		int clearcoatMap;
		int clearcoatNormalMap;
		vec2 clearcoatNormalScale;
		float clearcoatRoughness;
		int clearcoatRoughnessMap;

		int iridescenceMap;
		int iridescenceThicknessMap;
		float iridescence;
		float iridescenceIor;
		float iridescenceThicknessMinimum;
		float iridescenceThicknessMaximum;

		vec3 specularColor;
		int specularColorMap;

		float specularIntensity;
		int specularIntensityMap;
		bool thinFilm;

		vec3 attenuationColor;
		float attenuationDistance;

		int alphaMap;

		bool castShadow;
		float opacity;
		float alphaTest;

		float side;
		bool matte;

		float sheen;
		vec3 sheenColor;
		int sheenColorMap;
		float sheenRoughness;
		int sheenRoughnessMap;

		bool vertexColors;
		bool flatShading;
		bool transparent;
		bool fogVolume;

		mat3 mapTransform;
		mat3 metalnessMapTransform;
		mat3 roughnessMapTransform;
		mat3 transmissionMapTransform;
		mat3 emissiveMapTransform;
		mat3 normalMapTransform;
		mat3 clearcoatMapTransform;
		mat3 clearcoatNormalMapTransform;
		mat3 clearcoatRoughnessMapTransform;
		mat3 sheenColorMapTransform;
		mat3 sheenRoughnessMapTransform;
		mat3 iridescenceMapTransform;
		mat3 iridescenceThicknessMapTransform;
		mat3 specularColorMapTransform;
		mat3 specularIntensityMapTransform;

	};

	mat3 readTextureTransform( sampler2D tex, uint index ) {

		mat3 textureTransform;

		vec4 row1 = texelFetch1D( tex, index );
		vec4 row2 = texelFetch1D( tex, index + 1u );

		textureTransform[0] = vec3(row1.r, row2.r, 0.0);
		textureTransform[1] = vec3(row1.g, row2.g, 0.0);
		textureTransform[2] = vec3(row1.b, row2.b, 1.0);

		return textureTransform;

	}

	Material readMaterialInfo( sampler2D tex, uint index ) {

		uint i = index * 45u;

		vec4 s0 = texelFetch1D( tex, i + 0u );
		vec4 s1 = texelFetch1D( tex, i + 1u );
		vec4 s2 = texelFetch1D( tex, i + 2u );
		vec4 s3 = texelFetch1D( tex, i + 3u );
		vec4 s4 = texelFetch1D( tex, i + 4u );
		vec4 s5 = texelFetch1D( tex, i + 5u );
		vec4 s6 = texelFetch1D( tex, i + 6u );
		vec4 s7 = texelFetch1D( tex, i + 7u );
		vec4 s8 = texelFetch1D( tex, i + 8u );
		vec4 s9 = texelFetch1D( tex, i + 9u );
		vec4 s10 = texelFetch1D( tex, i + 10u );
		vec4 s11 = texelFetch1D( tex, i + 11u );
		vec4 s12 = texelFetch1D( tex, i + 12u );
		vec4 s13 = texelFetch1D( tex, i + 13u );
		vec4 s14 = texelFetch1D( tex, i + 14u );

		Material m;
		m.color = s0.rgb;
		m.map = int( round( s0.a ) );

		m.metalness = s1.r;
		m.metalnessMap = int( round( s1.g ) );
		m.roughness = s1.b;
		m.roughnessMap = int( round( s1.a ) );

		m.ior = s2.r;
		m.transmission = s2.g;
		m.transmissionMap = int( round( s2.b ) );
		m.emissiveIntensity = s2.a;

		m.emissive = s3.rgb;
		m.emissiveMap = int( round( s3.a ) );

		m.normalMap = int( round( s4.r ) );
		m.normalScale = s4.gb;

		m.clearcoat = s4.a;
		m.clearcoatMap = int( round( s5.r ) );
		m.clearcoatRoughness = s5.g;
		m.clearcoatRoughnessMap = int( round( s5.b ) );
		m.clearcoatNormalMap = int( round( s5.a ) );
		m.clearcoatNormalScale = s6.rg;

		m.sheen = s6.a;
		m.sheenColor = s7.rgb;
		m.sheenColorMap = int( round( s7.a ) );
		m.sheenRoughness = s8.r;
		m.sheenRoughnessMap = int( round( s8.g ) );

		m.iridescenceMap = int( round( s8.b ) );
		m.iridescenceThicknessMap = int( round( s8.a ) );
		m.iridescence = s9.r;
		m.iridescenceIor = s9.g;
		m.iridescenceThicknessMinimum = s9.b;
		m.iridescenceThicknessMaximum = s9.a;

		m.specularColor = s10.rgb;
		m.specularColorMap = int( round( s10.a ) );

		m.specularIntensity = s11.r;
		m.specularIntensityMap = int( round( s11.g ) );
		m.thinFilm = bool( s11.b );

		m.attenuationColor = s12.rgb;
		m.attenuationDistance = s12.a;

		m.alphaMap = int( round( s13.r ) );

		m.opacity = s13.g;
		m.alphaTest = s13.b;
		m.side = s13.a;

		m.matte = bool( s14.r );
		m.castShadow = bool( s14.g );
		m.vertexColors = bool( int( s14.b ) & 1 );
		m.flatShading = bool( int( s14.b ) & 2 );
		m.fogVolume = bool( int( s14.b ) & 4 );
		m.transparent = bool( s14.a );

		uint firstTextureTransformIdx = i + 15u;

		// mat3( 1.0 ) is an identity matrix
		m.mapTransform = m.map == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx );
		m.metalnessMapTransform = m.metalnessMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 2u );
		m.roughnessMapTransform = m.roughnessMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 4u );
		m.transmissionMapTransform = m.transmissionMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 6u );
		m.emissiveMapTransform = m.emissiveMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 8u );
		m.normalMapTransform = m.normalMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 10u );
		m.clearcoatMapTransform = m.clearcoatMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 12u );
		m.clearcoatNormalMapTransform = m.clearcoatNormalMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 14u );
		m.clearcoatRoughnessMapTransform = m.clearcoatRoughnessMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 16u );
		m.sheenColorMapTransform = m.sheenColorMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 18u );
		m.sheenRoughnessMapTransform = m.sheenRoughnessMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 20u );
		m.iridescenceMapTransform = m.iridescenceMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 22u );
		m.iridescenceThicknessMapTransform = m.iridescenceThicknessMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 24u );
		m.specularColorMapTransform = m.specularColorMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 26u );
		m.specularIntensityMapTransform = m.specularIntensityMap == - 1 ? mat3( 1.0 ) : readTextureTransform( tex, firstTextureTransformIdx + 28u );

		return m;

	}

`,dn=`

	struct SurfaceRecord {

		// surface type
		bool volumeParticle;

		// geometry
		vec3 faceNormal;
		bool frontFace;
		vec3 normal;
		mat3 normalBasis;
		mat3 normalInvBasis;

		// cached properties
		float eta;
		float f0;

		// material
		float roughness;
		float filteredRoughness;
		float metalness;
		vec3 color;
		vec3 emission;

		// transmission
		float ior;
		float transmission;
		bool thinFilm;
		vec3 attenuationColor;
		float attenuationDistance;

		// clearcoat
		vec3 clearcoatNormal;
		mat3 clearcoatBasis;
		mat3 clearcoatInvBasis;
		float clearcoat;
		float clearcoatRoughness;
		float filteredClearcoatRoughness;

		// sheen
		float sheen;
		vec3 sheenColor;
		float sheenRoughness;

		// iridescence
		float iridescence;
		float iridescenceIor;
		float iridescenceThickness;

		// specular
		vec3 specularColor;
		float specularIntensity;
	};

	struct ScatterRecord {
		float specularPdf;
		float pdf;
		vec3 direction;
		vec3 color;
	};

`,mn=`

	// samples the the given environment map in the given direction
	vec3 sampleEquirectColor( sampler2D envMap, vec3 direction ) {

		return texture2D( envMap, equirectDirectionToUv( direction ) ).rgb;

	}

	// gets the pdf of the given direction to sample
	float equirectDirectionPdf( vec3 direction ) {

		vec2 uv = equirectDirectionToUv( direction );
		float theta = uv.y * PI;
		float sinTheta = sin( theta );
		if ( sinTheta == 0.0 ) {

			return 0.0;

		}

		return 1.0 / ( 2.0 * PI * PI * sinTheta );

	}

	// samples the color given env map with CDF and returns the pdf of the direction
	float sampleEquirect( vec3 direction, inout vec3 color ) {

		float totalSum = envMapInfo.totalSum;
		if ( totalSum == 0.0 ) {

			color = vec3( 0.0 );
			return 1.0;

		}

		vec2 uv = equirectDirectionToUv( direction );
		color = texture2D( envMapInfo.map, uv ).rgb;

		float lum = luminance( color );
		ivec2 resolution = textureSize( envMapInfo.map, 0 );
		float pdf = lum / totalSum;

		return float( resolution.x * resolution.y ) * pdf * equirectDirectionPdf( direction );

	}

	// samples a direction of the envmap with color and retrieves pdf
	float sampleEquirectProbability( vec2 r, inout vec3 color, inout vec3 direction ) {

		// sample env map cdf
		float v = texture2D( envMapInfo.marginalWeights, vec2( r.x, 0.0 ) ).x;
		float u = texture2D( envMapInfo.conditionalWeights, vec2( r.y, v ) ).x;
		vec2 uv = vec2( u, v );

		vec3 derivedDirection = equirectUvToDirection( uv );
		direction = derivedDirection;
		color = texture2D( envMapInfo.map, uv ).rgb;

		float totalSum = envMapInfo.totalSum;
		float lum = luminance( color );
		ivec2 resolution = textureSize( envMapInfo.map, 0 );
		float pdf = lum / totalSum;

		return float( resolution.x * resolution.y ) * pdf * equirectDirectionPdf( direction );

	}
`,pn=`

	float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {

		return smoothstep( coneCosine, penumbraCosine, angleCosine );

	}

	float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {

		// based upon Frostbite 3 Moving to Physically-based Rendering
		// page 32, equation 26: E[window1]
		// https://seblagarde.files.wordpress.com/2015/07/course_notes_moving_frostbite_to_pbr_v32.pdf
		float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), EPSILON );

		if ( cutoffDistance > 0.0 ) {

			distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );

		}

		return distanceFalloff;

	}

	float getPhotometricAttenuation( sampler2DArray iesProfiles, int iesProfile, vec3 posToLight, vec3 lightDir, vec3 u, vec3 v ) {

		float cosTheta = dot( posToLight, lightDir );
		float angle = acos( cosTheta ) / PI;

		return texture2D( iesProfiles, vec3( angle, 0.0, iesProfile ) ).r;

	}

	struct LightRecord {

		float dist;
		vec3 direction;
		float pdf;
		vec3 emission;
		int type;

	};

	bool intersectLightAtIndex( sampler2D lights, vec3 rayOrigin, vec3 rayDirection, uint l, inout LightRecord lightRec ) {

		bool didHit = false;
		Light light = readLightInfo( lights, l );

		vec3 u = light.u;
		vec3 v = light.v;

		// check for backface
		vec3 normal = normalize( cross( u, v ) );
		if ( dot( normal, rayDirection ) > 0.0 ) {

			u *= 1.0 / dot( u, u );
			v *= 1.0 / dot( v, v );

			float dist;

			// MIS / light intersection is not supported for punctual lights.
			if(
				( light.type == RECT_AREA_LIGHT_TYPE && intersectsRectangle( light.position, normal, u, v, rayOrigin, rayDirection, dist ) ) ||
				( light.type == CIRC_AREA_LIGHT_TYPE && intersectsCircle( light.position, normal, u, v, rayOrigin, rayDirection, dist ) )
			) {

				float cosTheta = dot( rayDirection, normal );
				didHit = true;
				lightRec.dist = dist;
				lightRec.pdf = ( dist * dist ) / ( light.area * cosTheta );
				lightRec.emission = light.color * light.intensity;
				lightRec.direction = rayDirection;
				lightRec.type = light.type;

			}

		}

		return didHit;

	}

	LightRecord randomAreaLightSample( Light light, vec3 rayOrigin, vec2 ruv ) {

		vec3 randomPos;
		if( light.type == RECT_AREA_LIGHT_TYPE ) {

			// rectangular area light
			randomPos = light.position + light.u * ( ruv.x - 0.5 ) + light.v * ( ruv.y - 0.5 );

		} else if( light.type == CIRC_AREA_LIGHT_TYPE ) {

			// circular area light
			float r = 0.5 * sqrt( ruv.x );
			float theta = ruv.y * 2.0 * PI;
			float x = r * cos( theta );
			float y = r * sin( theta );

			randomPos = light.position + light.u * x + light.v * y;

		}

		vec3 toLight = randomPos - rayOrigin;
		float lightDistSq = dot( toLight, toLight );
		float dist = sqrt( lightDistSq );
		vec3 direction = toLight / dist;
		vec3 lightNormal = normalize( cross( light.u, light.v ) );

		LightRecord lightRec;
		lightRec.type = light.type;
		lightRec.emission = light.color * light.intensity;
		lightRec.dist = dist;
		lightRec.direction = direction;

		// TODO: the denominator is potentially zero
		lightRec.pdf = lightDistSq / ( light.area * dot( direction, lightNormal ) );

		return lightRec;

	}

	LightRecord randomSpotLightSample( Light light, sampler2DArray iesProfiles, vec3 rayOrigin, vec2 ruv ) {

		float radius = light.radius * sqrt( ruv.x );
		float theta = ruv.y * 2.0 * PI;
		float x = radius * cos( theta );
		float y = radius * sin( theta );

		vec3 u = light.u;
		vec3 v = light.v;
		vec3 normal = normalize( cross( u, v ) );

		float angle = acos( light.coneCos );
		float angleTan = tan( angle );
		float startDistance = light.radius / max( angleTan, EPSILON );

		vec3 randomPos = light.position - normal * startDistance + u * x + v * y;
		vec3 toLight = randomPos - rayOrigin;
		float lightDistSq = dot( toLight, toLight );
		float dist = sqrt( lightDistSq );

		vec3 direction = toLight / max( dist, EPSILON );
		float cosTheta = dot( direction, normal );

		float spotAttenuation = light.iesProfile != - 1 ?
			getPhotometricAttenuation( iesProfiles, light.iesProfile, direction, normal, u, v ) :
			getSpotAttenuation( light.coneCos, light.penumbraCos, cosTheta );

		float distanceAttenuation = getDistanceAttenuation( dist, light.distance, light.decay );
		LightRecord lightRec;
		lightRec.type = light.type;
		lightRec.dist = dist;
		lightRec.direction = direction;
		lightRec.emission = light.color * light.intensity * distanceAttenuation * spotAttenuation;
		lightRec.pdf = 1.0;

		return lightRec;

	}

	LightRecord randomLightSample( sampler2D lights, sampler2DArray iesProfiles, uint lightCount, vec3 rayOrigin, vec3 ruv ) {

		LightRecord result;

		// pick a random light
		uint l = uint( ruv.x * float( lightCount ) );
		Light light = readLightInfo( lights, l );

		if ( light.type == SPOT_LIGHT_TYPE ) {

			result = randomSpotLightSample( light, iesProfiles, rayOrigin, ruv.yz );

		} else if ( light.type == POINT_LIGHT_TYPE ) {

			vec3 lightRay = light.u - rayOrigin;
			float lightDist = length( lightRay );
			float cutoffDistance = light.distance;
			float distanceFalloff = 1.0 / max( pow( lightDist, light.decay ), 0.01 );
			if ( cutoffDistance > 0.0 ) {

				distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDist / cutoffDistance ) ) );

			}

			LightRecord rec;
			rec.direction = normalize( lightRay );
			rec.dist = length( lightRay );
			rec.pdf = 1.0;
			rec.emission = light.color * light.intensity * distanceFalloff;
			rec.type = light.type;
			result = rec;

		} else if ( light.type == DIR_LIGHT_TYPE ) {

			LightRecord rec;
			rec.dist = 1e10;
			rec.direction = light.u;
			rec.pdf = 1.0;
			rec.emission = light.color * light.intensity;
			rec.type = light.type;

			result = rec;

		} else {

			// sample the light
			result = randomAreaLightSample( light, rayOrigin, ruv.yz );

		}

		return result;

	}

`,gn=`

	vec3 sampleHemisphere( vec3 n, vec2 uv ) {

		// https://www.rorydriscoll.com/2009/01/07/better-sampling/
		// https://graphics.pixar.com/library/OrthonormalB/paper.pdf
		float sign = n.z == 0.0 ? 1.0 : sign( n.z );
		float a = - 1.0 / ( sign + n.z );
		float b = n.x * n.y * a;
		vec3 b1 = vec3( 1.0 + sign * n.x * n.x * a, sign * b, - sign * n.x );
		vec3 b2 = vec3( b, sign + n.y * n.y * a, - n.y );

		float r = sqrt( uv.x );
		float theta = 2.0 * PI * uv.y;
		float x = r * cos( theta );
		float y = r * sin( theta );
		return x * b1 + y * b2 + sqrt( 1.0 - uv.x ) * n;

	}

	vec2 sampleTriangle( vec2 a, vec2 b, vec2 c, vec2 r ) {

		// get the edges of the triangle and the diagonal across the
		// center of the parallelogram
		vec2 e1 = a - b;
		vec2 e2 = c - b;
		vec2 diag = normalize( e1 + e2 );

		// pick the point in the parallelogram
		if ( r.x + r.y > 1.0 ) {

			r = vec2( 1.0 ) - r;

		}

		return e1 * r.x + e2 * r.y;

	}

	vec2 sampleCircle( vec2 uv ) {

		float angle = 2.0 * PI * uv.x;
		float radius = sqrt( uv.y );
		return vec2( cos( angle ), sin( angle ) ) * radius;

	}

	vec3 sampleSphere( vec2 uv ) {

		float u = ( uv.x - 0.5 ) * 2.0;
		float t = uv.y * PI * 2.0;
		float f = sqrt( 1.0 - u * u );

		return vec3( f * cos( t ), f * sin( t ), u );

	}

	vec2 sampleRegularPolygon( int sides, vec3 uvw ) {

		sides = max( sides, 3 );

		vec3 r = uvw;
		float anglePerSegment = 2.0 * PI / float( sides );
		float segment = floor( float( sides ) * r.x );

		float angle1 = anglePerSegment * segment;
		float angle2 = angle1 + anglePerSegment;
		vec2 a = vec2( sin( angle1 ), cos( angle1 ) );
		vec2 b = vec2( 0.0, 0.0 );
		vec2 c = vec2( sin( angle2 ), cos( angle2 ) );

		return sampleTriangle( a, b, c, r.yz );

	}

	// samples an aperture shape with the given number of sides. 0 means circle
	vec2 sampleAperture( int blades, vec3 uvw ) {

		return blades == 0 ?
			sampleCircle( uvw.xy ) :
			sampleRegularPolygon( blades, uvw );

	}


`,vn=`

	bool totalInternalReflection( float cosTheta, float eta ) {

		float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
		return eta * sinTheta > 1.0;

	}

	// https://google.github.io/filament/Filament.md.html#materialsystem/diffusebrdf
	float schlickFresnel( float cosine, float f0 ) {

		return f0 + ( 1.0 - f0 ) * pow( 1.0 - cosine, 5.0 );

	}

	vec3 schlickFresnel( float cosine, vec3 f0 ) {

		return f0 + ( 1.0 - f0 ) * pow( 1.0 - cosine, 5.0 );

	}

	vec3 schlickFresnel( float cosine, vec3 f0, vec3 f90 ) {

		return f0 + ( f90 - f0 ) * pow( 1.0 - cosine, 5.0 );

	}

	float dielectricFresnel( float cosThetaI, float eta ) {

		// https://schuttejoe.github.io/post/disneybsdf/
		float ni = eta;
		float nt = 1.0;

		// Check for total internal reflection
		float sinThetaISq = 1.0f - cosThetaI * cosThetaI;
		float sinThetaTSq = eta * eta * sinThetaISq;
		if( sinThetaTSq >= 1.0 ) {

			return 1.0;

		}

		float sinThetaT = sqrt( sinThetaTSq );

		float cosThetaT = sqrt( max( 0.0, 1.0f - sinThetaT * sinThetaT ) );
		float rParallel = ( ( nt * cosThetaI ) - ( ni * cosThetaT ) ) / ( ( nt * cosThetaI ) + ( ni * cosThetaT ) );
		float rPerpendicular = ( ( ni * cosThetaI ) - ( nt * cosThetaT ) ) / ( ( ni * cosThetaI ) + ( nt * cosThetaT ) );
		return ( rParallel * rParallel + rPerpendicular * rPerpendicular ) / 2.0;

	}

	// https://raytracing.github.io/books/RayTracingInOneWeekend.html#dielectrics/schlickapproximation
	float iorRatioToF0( float eta ) {

		return pow( ( 1.0 - eta ) / ( 1.0 + eta ), 2.0 );

	}

	vec3 evaluateFresnel( float cosTheta, float eta, vec3 f0, vec3 f90 ) {

		if ( totalInternalReflection( cosTheta, eta ) ) {

			return f90;

		}

		return schlickFresnel( cosTheta, f0, f90 );

	}

	// TODO: disney fresnel was removed and replaced with this fresnel function to better align with
	// the glTF but is causing blown out pixels. Should be revisited
	// float evaluateFresnelWeight( float cosTheta, float eta, float f0 ) {

	// 	if ( totalInternalReflection( cosTheta, eta ) ) {

	// 		return 1.0;

	// 	}

	// 	return schlickFresnel( cosTheta, f0 );

	// }

	// https://schuttejoe.github.io/post/disneybsdf/
	float disneyFresnel( vec3 wo, vec3 wi, vec3 wh, float f0, float eta, float metalness ) {

		float dotHV = dot( wo, wh );
		if ( totalInternalReflection( dotHV, eta ) ) {

			return 1.0;

		}

		float dotHL = dot( wi, wh );
		float dielectricFresnel = dielectricFresnel( abs( dotHV ), eta );
		float metallicFresnel = schlickFresnel( dotHL, f0 );

		return mix( dielectricFresnel, metallicFresnel, metalness );

	}

`,xn=`

	// Fast arccos approximation used to remove banding artifacts caused by numerical errors in acos.
	// This is a cubic Lagrange interpolating polynomial for x = [-1, -1/2, 0, 1/2, 1].
	// For more information see: https://github.com/gkjohnson/three-gpu-pathtracer/pull/171#issuecomment-1152275248
	float acosApprox( float x ) {

		x = clamp( x, -1.0, 1.0 );
		return ( - 0.69813170079773212 * x * x - 0.87266462599716477 ) * x + 1.5707963267948966;

	}

	// An acos with input values bound to the range [-1, 1].
	float acosSafe( float x ) {

		return acos( clamp( x, -1.0, 1.0 ) );

	}

	float saturateCos( float val ) {

		return clamp( val, 0.001, 1.0 );

	}

	float square( float t ) {

		return t * t;

	}

	vec2 square( vec2 t ) {

		return t * t;

	}

	vec3 square( vec3 t ) {

		return t * t;

	}

	vec4 square( vec4 t ) {

		return t * t;

	}

	vec2 rotateVector( vec2 v, float t ) {

		float ac = cos( t );
		float as = sin( t );
		return vec2(
			v.x * ac - v.y * as,
			v.x * as + v.y * ac
		);

	}

	// forms a basis with the normal vector as Z
	mat3 getBasisFromNormal( vec3 normal ) {

		vec3 other;
		if ( abs( normal.x ) > 0.5 ) {

			other = vec3( 0.0, 1.0, 0.0 );

		} else {

			other = vec3( 1.0, 0.0, 0.0 );

		}

		vec3 ortho = normalize( cross( normal, other ) );
		vec3 ortho2 = normalize( cross( normal, ortho ) );
		return mat3( ortho2, ortho, normal );

	}

`,yn=`

	// Finds the point where the ray intersects the plane defined by u and v and checks if this point
	// falls in the bounds of the rectangle on that same plane.
	// Plane intersection: https://lousodrome.net/blog/light/2020/07/03/intersection-of-a-ray-and-a-plane/
	bool intersectsRectangle( vec3 center, vec3 normal, vec3 u, vec3 v, vec3 rayOrigin, vec3 rayDirection, inout float dist ) {

		float t = dot( center - rayOrigin, normal ) / dot( rayDirection, normal );

		if ( t > EPSILON ) {

			vec3 p = rayOrigin + rayDirection * t;
			vec3 vi = p - center;

			// check if p falls inside the rectangle
			float a1 = dot( u, vi );
			if ( abs( a1 ) <= 0.5 ) {

				float a2 = dot( v, vi );
				if ( abs( a2 ) <= 0.5 ) {

					dist = t;
					return true;

				}

			}

		}

		return false;

	}

	// Finds the point where the ray intersects the plane defined by u and v and checks if this point
	// falls in the bounds of the circle on that same plane. See above URL for a description of the plane intersection algorithm.
	bool intersectsCircle( vec3 position, vec3 normal, vec3 u, vec3 v, vec3 rayOrigin, vec3 rayDirection, inout float dist ) {

		float t = dot( position - rayOrigin, normal ) / dot( rayDirection, normal );

		if ( t > EPSILON ) {

			vec3 hit = rayOrigin + rayDirection * t;
			vec3 vi = hit - position;

			float a1 = dot( u, vi );
			float a2 = dot( v, vi );

			if( length( vec2( a1, a2 ) ) <= 0.5 ) {

				dist = t;
				return true;

			}

		}

		return false;

	}

`,bn=`

	// add texel fetch functions for texture arrays
	vec4 texelFetch1D( sampler2DArray tex, int layer, uint index ) {

		uint width = uint( textureSize( tex, 0 ).x );
		uvec2 uv;
		uv.x = index % width;
		uv.y = index / width;

		return texelFetch( tex, ivec3( uv, layer ), 0 );

	}

	vec4 textureSampleBarycoord( sampler2DArray tex, int layer, vec3 barycoord, uvec3 faceIndices ) {

		return
			barycoord.x * texelFetch1D( tex, layer, faceIndices.x ) +
			barycoord.y * texelFetch1D( tex, layer, faceIndices.y ) +
			barycoord.z * texelFetch1D( tex, layer, faceIndices.z );

	}

`,Mr=`

	// TODO: possibly this should be renamed something related to material or path tracing logic

	#ifndef RAY_OFFSET
	#define RAY_OFFSET 1e-4
	#endif

	// adjust the hit point by the surface normal by a factor of some offset and the
	// maximum component-wise value of the current point to accommodate floating point
	// error as values increase.
	vec3 stepRayOrigin( vec3 rayOrigin, vec3 rayDirection, vec3 offset, float dist ) {

		vec3 point = rayOrigin + rayDirection * dist;
		vec3 absPoint = abs( point );
		float maxPoint = max( absPoint.x, max( absPoint.y, absPoint.z ) );
		return point + offset * ( maxPoint + 1.0 ) * RAY_OFFSET;

	}

	// https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_volume/README.md#attenuation
	vec3 transmissionAttenuation( float dist, vec3 attColor, float attDist ) {

		vec3 ot = - log( attColor ) / attDist;
		return exp( - ot * dist );

	}

	vec3 getHalfVector( vec3 wi, vec3 wo, float eta ) {

		// get the half vector - assuming if the light incident vector is on the other side
		// of the that it's transmissive.
		vec3 h;
		if ( wi.z > 0.0 ) {

			h = normalize( wi + wo );

		} else {

			// Scale by the ior ratio to retrieve the appropriate half vector
			// From Section 2.2 on computing the transmission half vector:
			// https://blog.selfshadow.com/publications/s2015-shading-course/burley/s2015_pbs_disney_bsdf_notes.pdf
			h = normalize( wi + wo * eta );

		}

		h *= sign( h.z );
		return h;

	}

	vec3 getHalfVector( vec3 a, vec3 b ) {

		return normalize( a + b );

	}

	// The discrepancy between interpolated surface normal and geometry normal can cause issues when a ray
	// is cast that is on the top side of the geometry normal plane but below the surface normal plane. If
	// we find a ray like that we ignore it to avoid artifacts.
	// This function returns if the direction is on the same side of both planes.
	bool isDirectionValid( vec3 direction, vec3 surfaceNormal, vec3 geometryNormal ) {

		bool aboveSurfaceNormal = dot( direction, surfaceNormal ) > 0.0;
		bool aboveGeometryNormal = dot( direction, geometryNormal ) > 0.0;
		return aboveSurfaceNormal == aboveGeometryNormal;

	}

	// ray sampling x and z are swapped to align with expected background view
	vec2 equirectDirectionToUv( vec3 direction ) {

		// from Spherical.setFromCartesianCoords
		vec2 uv = vec2( atan( direction.z, direction.x ), acos( direction.y ) );
		uv /= vec2( 2.0 * PI, PI );

		// apply adjustments to get values in range [0, 1] and y right side up
		uv.x += 0.5;
		uv.y = 1.0 - uv.y;
		return uv;

	}

	vec3 equirectUvToDirection( vec2 uv ) {

		// undo above adjustments
		uv.x -= 0.5;
		uv.y = 1.0 - uv.y;

		// from Vector3.setFromSphericalCoords
		float theta = uv.x * 2.0 * PI;
		float phi = uv.y * PI;

		float sinPhi = sin( phi );

		return vec3( sinPhi * cos( theta ), cos( phi ), sinPhi * sin( theta ) );

	}

	// power heuristic for multiple importance sampling
	float misHeuristic( float a, float b ) {

		float aa = a * a;
		float bb = b * b;
		return aa / ( aa + bb );

	}

	// tentFilter from Peter Shirley's 'Realistic Ray Tracing (2nd Edition)' book, pg. 60
	// erichlof/THREE.js-PathTracing-Renderer/
	float tentFilter( float x ) {

		return x < 0.5 ? sqrt( 2.0 * x ) - 1.0 : 1.0 - sqrt( 2.0 - ( 2.0 * x ) );

	}
`,$i=`

	// https://www.shadertoy.com/view/wltcRS
	uvec4 WHITE_NOISE_SEED;

	void rng_initialize( vec2 p, int frame ) {

		// white noise seed
		WHITE_NOISE_SEED = uvec4( p, uint( frame ), uint( p.x ) + uint( p.y ) );

	}

	// https://www.pcg-random.org/
	void pcg4d( inout uvec4 v ) {

		v = v * 1664525u + 1013904223u;
		v.x += v.y * v.w;
		v.y += v.z * v.x;
		v.z += v.x * v.y;
		v.w += v.y * v.z;
		v = v ^ ( v >> 16u );
		v.x += v.y*v.w;
		v.y += v.z*v.x;
		v.z += v.x*v.y;
		v.w += v.y*v.z;

	}

	// returns [ 0, 1 ]
	float pcgRand() {

		pcg4d( WHITE_NOISE_SEED );
		return float( WHITE_NOISE_SEED.x ) / float( 0xffffffffu );

	}

	vec2 pcgRand2() {

		pcg4d( WHITE_NOISE_SEED );
		return vec2( WHITE_NOISE_SEED.xy ) / float(0xffffffffu);

	}

	vec3 pcgRand3() {

		pcg4d( WHITE_NOISE_SEED );
		return vec3( WHITE_NOISE_SEED.xyz ) / float( 0xffffffffu );

	}

	vec4 pcgRand4() {

		pcg4d( WHITE_NOISE_SEED );
		return vec4( WHITE_NOISE_SEED ) / float( 0xffffffffu );

	}
`,Tn=`

	uniform sampler2D stratifiedTexture;
	uniform sampler2D stratifiedOffsetTexture;

	uint sobolPixelIndex = 0u;
	uint sobolPathIndex = 0u;
	uint sobolBounceIndex = 0u;
	vec4 pixelSeed = vec4( 0 );

	vec4 rand4( int v ) {

		ivec2 uv = ivec2( v, sobolBounceIndex );
		vec4 stratifiedSample = texelFetch( stratifiedTexture, uv, 0 );
		return fract( stratifiedSample + pixelSeed.r ); // blue noise + stratified samples

	}

	vec3 rand3( int v ) {

		return rand4( v ).xyz;

	}

	vec2 rand2( int v ) {

		return rand4( v ).xy;

	}

	float rand( int v ) {

		return rand4( v ).x;

	}

	void rng_initialize( vec2 screenCoord, int frame ) {

		// tile the small noise texture across the entire screen
		ivec2 noiseSize = ivec2( textureSize( stratifiedOffsetTexture, 0 ) );
		ivec2 pixel = ivec2( screenCoord.xy ) % noiseSize;
		vec2 pixelWidth = 1.0 / vec2( noiseSize );
		vec2 uv = vec2( pixel ) * pixelWidth + pixelWidth * 0.5;

		// note that using "texelFetch" here seems to break Android for some reason
		pixelSeed = texture( stratifiedOffsetTexture, uv );

	}

`,wn=`

	// diffuse
	float diffuseEval( vec3 wo, vec3 wi, vec3 wh, SurfaceRecord surf, inout vec3 color ) {

		// https://schuttejoe.github.io/post/disneybsdf/
		float fl = schlickFresnel( wi.z, 0.0 );
		float fv = schlickFresnel( wo.z, 0.0 );

		float metalFactor = ( 1.0 - surf.metalness );
		float transFactor = ( 1.0 - surf.transmission );
		float rr = 0.5 + 2.0 * surf.roughness * fl * fl;
		float retro = rr * ( fl + fv + fl * fv * ( rr - 1.0f ) );
		float lambert = ( 1.0f - 0.5f * fl ) * ( 1.0f - 0.5f * fv );

		// TODO: subsurface approx?

		// float F = evaluateFresnelWeight( dot( wo, wh ), surf.eta, surf.f0 );
		float F = disneyFresnel( wo, wi, wh, surf.f0, surf.eta, surf.metalness );
		color = ( 1.0 - F ) * transFactor * metalFactor * wi.z * surf.color * ( retro + lambert ) / PI;

		return wi.z / PI;

	}

	vec3 diffuseDirection( vec3 wo, SurfaceRecord surf ) {

		vec3 lightDirection = sampleSphere( rand2( 11 ) );
		lightDirection.z += 1.0;
		lightDirection = normalize( lightDirection );

		return lightDirection;

	}

	// specular
	float specularEval( vec3 wo, vec3 wi, vec3 wh, SurfaceRecord surf, inout vec3 color ) {

		// if roughness is set to 0 then D === NaN which results in black pixels
		float metalness = surf.metalness;
		float roughness = surf.filteredRoughness;

		float eta = surf.eta;
		float f0 = surf.f0;

		vec3 f0Color = mix( f0 * surf.specularColor * surf.specularIntensity, surf.color, surf.metalness );
		vec3 f90Color = vec3( mix( surf.specularIntensity, 1.0, surf.metalness ) );
		vec3 F = evaluateFresnel( dot( wo, wh ), eta, f0Color, f90Color );

		vec3 iridescenceF = evalIridescence( 1.0, surf.iridescenceIor, dot( wi, wh ), surf.iridescenceThickness, f0Color );
		F = mix( F, iridescenceF,  surf.iridescence );

		// PDF
		// See 14.1.1 Microfacet BxDFs in https://www.pbr-book.org/
		float incidentTheta = acos( wo.z );
		float G = ggxShadowMaskG2( wi, wo, roughness );
		float D = ggxDistribution( wh, roughness );
		float G1 = ggxShadowMaskG1( incidentTheta, roughness );
		float ggxPdf = D * G1 * max( 0.0, abs( dot( wo, wh ) ) ) / abs ( wo.z );

		color = wi.z * F * G * D / ( 4.0 * abs( wi.z * wo.z ) );
		return ggxPdf / ( 4.0 * dot( wo, wh ) );

	}

	vec3 specularDirection( vec3 wo, SurfaceRecord surf ) {

		// sample ggx vndf distribution which gives a new normal
		float roughness = surf.filteredRoughness;
		vec3 halfVector = ggxDirection(
			wo,
			vec2( roughness ),
			rand2( 12 )
		);

		// apply to new ray by reflecting off the new normal
		return - reflect( wo, halfVector );

	}


	// transmission
	/*
	float transmissionEval( vec3 wo, vec3 wi, vec3 wh, SurfaceRecord surf, inout vec3 color ) {

		// See section 4.2 in https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf

		float filteredRoughness = surf.filteredRoughness;
		float eta = surf.eta;
		bool frontFace = surf.frontFace;
		bool thinFilm = surf.thinFilm;

		color = surf.transmission * surf.color;

		float denom = pow( eta * dot( wi, wh ) + dot( wo, wh ), 2.0 );
		return ggxPDF( wo, wh, filteredRoughness ) / denom;

	}

	vec3 transmissionDirection( vec3 wo, SurfaceRecord surf ) {

		float filteredRoughness = surf.filteredRoughness;
		float eta = surf.eta;
		bool frontFace = surf.frontFace;

		// sample ggx vndf distribution which gives a new normal
		vec3 halfVector = ggxDirection(
			wo,
			vec2( filteredRoughness ),
			rand2( 13 )
		);

		vec3 lightDirection = refract( normalize( - wo ), halfVector, eta );
		if ( surf.thinFilm ) {

			lightDirection = - refract( normalize( - lightDirection ), - vec3( 0.0, 0.0, 1.0 ), 1.0 / eta );

		}

		return normalize( lightDirection );

	}
	*/

	// TODO: This is just using a basic cosine-weighted specular distribution with an
	// incorrect PDF value at the moment. Update it to correctly use a GGX distribution
	float transmissionEval( vec3 wo, vec3 wi, vec3 wh, SurfaceRecord surf, inout vec3 color ) {

		color = surf.transmission * surf.color;

		// PDF
		// float F = evaluateFresnelWeight( dot( wo, wh ), surf.eta, surf.f0 );
		// float F = disneyFresnel( wo, wi, wh, surf.f0, surf.eta, surf.metalness );
		// if ( F >= 1.0 ) {

		// 	return 0.0;

		// }

		// return 1.0 / ( 1.0 - F );

		// reverted to previous to transmission. The above was causing black pixels
		float eta = surf.eta;
		float f0 = surf.f0;
		float cosTheta = min( wo.z, 1.0 );
		float sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
		float reflectance = schlickFresnel( cosTheta, f0 );
		bool cannotRefract = eta * sinTheta > 1.0;
		if ( cannotRefract ) {

			return 0.0;

		}

		return 1.0 / ( 1.0 - reflectance );

	}

	vec3 transmissionDirection( vec3 wo, SurfaceRecord surf ) {

		float roughness = surf.filteredRoughness;
		float eta = surf.eta;
		vec3 halfVector = normalize( vec3( 0.0, 0.0, 1.0 ) + sampleSphere( rand2( 13 ) ) * roughness );
		vec3 lightDirection = refract( normalize( - wo ), halfVector, eta );

		if ( surf.thinFilm ) {

			lightDirection = - refract( normalize( - lightDirection ), - vec3( 0.0, 0.0, 1.0 ), 1.0 / eta );

		}
		return normalize( lightDirection );

	}

	// clearcoat
	float clearcoatEval( vec3 wo, vec3 wi, vec3 wh, SurfaceRecord surf, inout vec3 color ) {

		float ior = 1.5;
		float f0 = iorRatioToF0( ior );
		bool frontFace = surf.frontFace;
		float roughness = surf.filteredClearcoatRoughness;

		float eta = frontFace ? 1.0 / ior : ior;
		float G = ggxShadowMaskG2( wi, wo, roughness );
		float D = ggxDistribution( wh, roughness );
		float F = schlickFresnel( dot( wi, wh ), f0 );

		float fClearcoat = F * D * G / ( 4.0 * abs( wi.z * wo.z ) );
		color = color * ( 1.0 - surf.clearcoat * F ) + fClearcoat * surf.clearcoat * wi.z;

		// PDF
		// See equation (27) in http://jcgt.org/published/0003/02/03/
		return ggxPDF( wo, wh, roughness ) / ( 4.0 * dot( wi, wh ) );

	}

	vec3 clearcoatDirection( vec3 wo, SurfaceRecord surf ) {

		// sample ggx vndf distribution which gives a new normal
		float roughness = surf.filteredClearcoatRoughness;
		vec3 halfVector = ggxDirection(
			wo,
			vec2( roughness ),
			rand2( 14 )
		);

		// apply to new ray by reflecting off the new normal
		return - reflect( wo, halfVector );

	}

	// sheen
	vec3 sheenColor( vec3 wo, vec3 wi, vec3 wh, SurfaceRecord surf ) {

		float cosThetaO = saturateCos( wo.z );
		float cosThetaI = saturateCos( wi.z );
		float cosThetaH = wh.z;

		float D = velvetD( cosThetaH, surf.sheenRoughness );
		float G = velvetG( cosThetaO, cosThetaI, surf.sheenRoughness );

		// See equation (1) in http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
		vec3 color = surf.sheenColor;
		color *= D * G / ( 4.0 * abs( cosThetaO * cosThetaI ) );
		color *= wi.z;

		return color;

	}

	// bsdf
	void getLobeWeights(
		vec3 wo, vec3 wi, vec3 wh, vec3 clearcoatWo, SurfaceRecord surf,
		inout float diffuseWeight, inout float specularWeight, inout float transmissionWeight, inout float clearcoatWeight
	) {

		float metalness = surf.metalness;
		float transmission = surf.transmission;
		// float fEstimate = evaluateFresnelWeight( dot( wo, wh ), surf.eta, surf.f0 );
		float fEstimate = disneyFresnel( wo, wi, wh, surf.f0, surf.eta, surf.metalness );

		float transSpecularProb = mix( max( 0.25, fEstimate ), 1.0, metalness );
		float diffSpecularProb = 0.5 + 0.5 * metalness;

		diffuseWeight = ( 1.0 - transmission ) * ( 1.0 - diffSpecularProb );
		specularWeight = transmission * transSpecularProb + ( 1.0 - transmission ) * diffSpecularProb;
		transmissionWeight = transmission * ( 1.0 - transSpecularProb );
		clearcoatWeight = surf.clearcoat * schlickFresnel( clearcoatWo.z, 0.04 );

		float totalWeight = diffuseWeight + specularWeight + transmissionWeight + clearcoatWeight;
		diffuseWeight /= totalWeight;
		specularWeight /= totalWeight;
		transmissionWeight /= totalWeight;
		clearcoatWeight /= totalWeight;
	}

	float bsdfEval(
		vec3 wo, vec3 clearcoatWo, vec3 wi, vec3 clearcoatWi, SurfaceRecord surf,
		float diffuseWeight, float specularWeight, float transmissionWeight, float clearcoatWeight, inout float specularPdf, inout vec3 color
	) {

		float metalness = surf.metalness;
		float transmission = surf.transmission;

		float spdf = 0.0;
		float dpdf = 0.0;
		float tpdf = 0.0;
		float cpdf = 0.0;
		color = vec3( 0.0 );

		vec3 halfVector = getHalfVector( wi, wo, surf.eta );

		// diffuse
		if ( diffuseWeight > 0.0 && wi.z > 0.0 ) {

			dpdf = diffuseEval( wo, wi, halfVector, surf, color );
			color *= 1.0 - surf.transmission;

		}

		// ggx specular
		if ( specularWeight > 0.0 && wi.z > 0.0 ) {

			vec3 outColor;
			spdf = specularEval( wo, wi, getHalfVector( wi, wo ), surf, outColor );
			color += outColor;

		}

		// transmission
		if ( transmissionWeight > 0.0 && wi.z < 0.0 ) {

			tpdf = transmissionEval( wo, wi, halfVector, surf, color );

		}

		// sheen
		color *= mix( 1.0, sheenAlbedoScaling( wo, wi, surf ), surf.sheen );
		color += sheenColor( wo, wi, halfVector, surf ) * surf.sheen;

		// clearcoat
		if ( clearcoatWi.z >= 0.0 && clearcoatWeight > 0.0 ) {

			vec3 clearcoatHalfVector = getHalfVector( clearcoatWo, clearcoatWi );
			cpdf = clearcoatEval( clearcoatWo, clearcoatWi, clearcoatHalfVector, surf, color );

		}

		float pdf =
			dpdf * diffuseWeight
			+ spdf * specularWeight
			+ tpdf * transmissionWeight
			+ cpdf * clearcoatWeight;

		// retrieve specular rays for the shadows flag
		specularPdf = spdf * specularWeight + cpdf * clearcoatWeight;

		return pdf;

	}

	float bsdfResult( vec3 worldWo, vec3 worldWi, SurfaceRecord surf, inout vec3 color ) {

		if ( surf.volumeParticle ) {

			color = surf.color / ( 4.0 * PI );
			return 1.0 / ( 4.0 * PI );

		}

		vec3 wo = normalize( surf.normalInvBasis * worldWo );
		vec3 wi = normalize( surf.normalInvBasis * worldWi );

		vec3 clearcoatWo = normalize( surf.clearcoatInvBasis * worldWo );
		vec3 clearcoatWi = normalize( surf.clearcoatInvBasis * worldWi );

		vec3 wh = getHalfVector( wo, wi, surf.eta );
		float diffuseWeight;
		float specularWeight;
		float transmissionWeight;
		float clearcoatWeight;
		getLobeWeights( wo, wi, wh, clearcoatWo, surf, diffuseWeight, specularWeight, transmissionWeight, clearcoatWeight );

		float specularPdf;
		return bsdfEval( wo, clearcoatWo, wi, clearcoatWi, surf, diffuseWeight, specularWeight, transmissionWeight, clearcoatWeight, specularPdf, color );

	}

	ScatterRecord bsdfSample( vec3 worldWo, SurfaceRecord surf ) {

		if ( surf.volumeParticle ) {

			ScatterRecord sampleRec;
			sampleRec.specularPdf = 0.0;
			sampleRec.pdf = 1.0 / ( 4.0 * PI );
			sampleRec.direction = sampleSphere( rand2( 16 ) );
			sampleRec.color = surf.color / ( 4.0 * PI );
			return sampleRec;

		}

		vec3 wo = normalize( surf.normalInvBasis * worldWo );
		vec3 clearcoatWo = normalize( surf.clearcoatInvBasis * worldWo );
		mat3 normalBasis = surf.normalBasis;
		mat3 invBasis = surf.normalInvBasis;
		mat3 clearcoatNormalBasis = surf.clearcoatBasis;
		mat3 clearcoatInvBasis = surf.clearcoatInvBasis;

		float diffuseWeight;
		float specularWeight;
		float transmissionWeight;
		float clearcoatWeight;
		// using normal and basically-reflected ray since we don't have proper half vector here
		getLobeWeights( wo, wo, vec3( 0, 0, 1 ), clearcoatWo, surf, diffuseWeight, specularWeight, transmissionWeight, clearcoatWeight );

		float pdf[4];
		pdf[0] = diffuseWeight;
		pdf[1] = specularWeight;
		pdf[2] = transmissionWeight;
		pdf[3] = clearcoatWeight;

		float cdf[4];
		cdf[0] = pdf[0];
		cdf[1] = pdf[1] + cdf[0];
		cdf[2] = pdf[2] + cdf[1];
		cdf[3] = pdf[3] + cdf[2];

		if( cdf[3] != 0.0 ) {

			float invMaxCdf = 1.0 / cdf[3];
			cdf[0] *= invMaxCdf;
			cdf[1] *= invMaxCdf;
			cdf[2] *= invMaxCdf;
			cdf[3] *= invMaxCdf;

		} else {

			cdf[0] = 1.0;
			cdf[1] = 0.0;
			cdf[2] = 0.0;
			cdf[3] = 0.0;

		}

		vec3 wi;
		vec3 clearcoatWi;

		float r = rand( 15 );
		if ( r <= cdf[0] ) { // diffuse

			wi = diffuseDirection( wo, surf );
			clearcoatWi = normalize( clearcoatInvBasis * normalize( normalBasis * wi ) );

		} else if ( r <= cdf[1] ) { // specular

			wi = specularDirection( wo, surf );
			clearcoatWi = normalize( clearcoatInvBasis * normalize( normalBasis * wi ) );

		} else if ( r <= cdf[2] ) { // transmission / refraction

			wi = transmissionDirection( wo, surf );
			clearcoatWi = normalize( clearcoatInvBasis * normalize( normalBasis * wi ) );

		} else if ( r <= cdf[3] ) { // clearcoat

			clearcoatWi = clearcoatDirection( clearcoatWo, surf );
			wi = normalize( invBasis * normalize( clearcoatNormalBasis * clearcoatWi ) );

		}

		ScatterRecord result;
		result.pdf = bsdfEval( wo, clearcoatWo, wi, clearcoatWi, surf, diffuseWeight, specularWeight, transmissionWeight, clearcoatWeight, result.specularPdf, result.color );
		result.direction = normalize( surf.normalBasis * wi );

		return result;

	}

`,Sn=`

	// returns the hit distance given the material density
	float intersectFogVolume( Material material, float u ) {

		// https://raytracing.github.io/books/RayTracingTheNextWeek.html#volumes/constantdensitymediums
		return material.opacity == 0.0 ? INFINITY : ( - 1.0 / material.opacity ) * log( u );

	}

	ScatterRecord sampleFogVolume( SurfaceRecord surf, vec2 uv ) {

		ScatterRecord sampleRec;
		sampleRec.specularPdf = 0.0;
		sampleRec.pdf = 1.0 / ( 2.0 * PI );
		sampleRec.direction = sampleSphere( uv );
		sampleRec.color = surf.color;
		return sampleRec;

	}

`,_n=`

	// The GGX functions provide sampling and distribution information for normals as output so
	// in order to get probability of scatter direction the half vector must be computed and provided.
	// [0] https://www.cs.cornell.edu/~srm/publications/EGSR07-btdf.pdf
	// [1] https://hal.archives-ouvertes.fr/hal-01509746/document
	// [2] http://jcgt.org/published/0007/04/01/
	// [4] http://jcgt.org/published/0003/02/03/

	// trowbridge-reitz === GGX === GTR

	vec3 ggxDirection( vec3 incidentDir, vec2 roughness, vec2 uv ) {

		// TODO: try GGXVNDF implementation from reference [2], here. Needs to update ggxDistribution
		// function below, as well

		// Implementation from reference [1]
		// stretch view
		vec3 V = normalize( vec3( roughness * incidentDir.xy, incidentDir.z ) );

		// orthonormal basis
		vec3 T1 = ( V.z < 0.9999 ) ? normalize( cross( V, vec3( 0.0, 0.0, 1.0 ) ) ) : vec3( 1.0, 0.0, 0.0 );
		vec3 T2 = cross( T1, V );

		// sample point with polar coordinates (r, phi)
		float a = 1.0 / ( 1.0 + V.z );
		float r = sqrt( uv.x );
		float phi = ( uv.y < a ) ? uv.y / a * PI : PI + ( uv.y - a ) / ( 1.0 - a ) * PI;
		float P1 = r * cos( phi );
		float P2 = r * sin( phi ) * ( ( uv.y < a ) ? 1.0 : V.z );

		// compute normal
		vec3 N = P1 * T1 + P2 * T2 + V * sqrt( max( 0.0, 1.0 - P1 * P1 - P2 * P2 ) );

		// unstretch
		N = normalize( vec3( roughness * N.xy, max( 0.0, N.z ) ) );

		return N;

	}

	// Below are PDF and related functions for use in a Monte Carlo path tracer
	// as specified in Appendix B of the following paper
	// See equation (34) from reference [0]
	float ggxLamda( float theta, float roughness ) {

		float tanTheta = tan( theta );
		float tanTheta2 = tanTheta * tanTheta;
		float alpha2 = roughness * roughness;

		float numerator = - 1.0 + sqrt( 1.0 + alpha2 * tanTheta2 );
		return numerator / 2.0;

	}

	// See equation (34) from reference [0]
	float ggxShadowMaskG1( float theta, float roughness ) {

		return 1.0 / ( 1.0 + ggxLamda( theta, roughness ) );

	}

	// See equation (125) from reference [4]
	float ggxShadowMaskG2( vec3 wi, vec3 wo, float roughness ) {

		float incidentTheta = acos( wi.z );
		float scatterTheta = acos( wo.z );
		return 1.0 / ( 1.0 + ggxLamda( incidentTheta, roughness ) + ggxLamda( scatterTheta, roughness ) );

	}

	// See equation (33) from reference [0]
	float ggxDistribution( vec3 halfVector, float roughness ) {

		float a2 = roughness * roughness;
		a2 = max( EPSILON, a2 );
		float cosTheta = halfVector.z;
		float cosTheta4 = pow( cosTheta, 4.0 );

		if ( cosTheta == 0.0 ) return 0.0;

		float theta = acosSafe( halfVector.z );
		float tanTheta = tan( theta );
		float tanTheta2 = pow( tanTheta, 2.0 );

		float denom = PI * cosTheta4 * pow( a2 + tanTheta2, 2.0 );
		return ( a2 / denom );

	}

	// See equation (3) from reference [2]
	float ggxPDF( vec3 wi, vec3 halfVector, float roughness ) {

		float incidentTheta = acos( wi.z );
		float D = ggxDistribution( halfVector, roughness );
		float G1 = ggxShadowMaskG1( incidentTheta, roughness );

		return D * G1 * max( 0.0, dot( wi, halfVector ) ) / wi.z;

	}

`,An=`

	// XYZ to sRGB color space
	const mat3 XYZ_TO_REC709 = mat3(
		3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);

	vec3 fresnel0ToIor( vec3 fresnel0 ) {

		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );

	}

	// Conversion FO/IOR
	vec3 iorToFresnel0( vec3 transmittedIor, float incidentIor ) {

		return square( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );

	}

	// ior is a value between 1.0 and 3.0. 1.0 is air interface
	float iorToFresnel0( float transmittedIor, float incidentIor ) {

		return square( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ) );

	}

	// Fresnel equations for dielectric/dielectric interfaces. See https://belcour.github.io/blog/research/2017/05/01/brdf-thin-film.html
	vec3 evalSensitivity( float OPD, vec3 shift ) {

		float phase = 2.0 * PI * OPD * 1.0e-9;

		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );

		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - square( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * square( phase ) );
		xyz /= 1.0685e-7;

		vec3 srgb = XYZ_TO_REC709 * xyz;
		return srgb;

	}

	// See Section 4. Analytic Spectral Integration, A Practical Extension to Microfacet Theory for the Modeling of Varying Iridescence, https://hal.archives-ouvertes.fr/hal-01518344/document
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {

		vec3 I;

		// Force iridescenceIor -> outsideIOR when thinFilmThickness -> 0.0
		float iridescenceIor = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );

		// Evaluate the cosTheta on the base layer (Snell law)
		float sinTheta2Sq = square( outsideIOR / iridescenceIor ) * ( 1.0 - square( cosTheta1 ) );

		// Handle TIR:
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {

			return vec3( 1.0 );

		}

		float cosTheta2 = sqrt( cosTheta2Sq );

		// First interface
		float R0 = iorToFresnel0( iridescenceIor, outsideIOR );
		float R12 = schlickFresnel( cosTheta1, R0 );
		float R21 = R12;
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIor < outsideIOR ) {

			phi12 = PI;

		}

		float phi21 = PI - phi12;

		// Second interface
		vec3 baseIOR = fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) ); // guard against 1.0
		vec3 R1 = iorToFresnel0( baseIOR, iridescenceIor );
		vec3 R23 = schlickFresnel( cosTheta2, R1 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[0] < iridescenceIor ) {

			phi23[ 0 ] = PI;

		}

		if ( baseIOR[1] < iridescenceIor ) {

			phi23[ 1 ] = PI;

		}

		if ( baseIOR[2] < iridescenceIor ) {

			phi23[ 2 ] = PI;

		}

		// Phase shift
		float OPD = 2.0 * iridescenceIor * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;

		// Compound terms
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = square( T121 ) * R23 / ( vec3( 1.0 ) - R123 );

		// Reflectance term for m = 0 (DC term amplitude)
		vec3 C0 = R12 + Rs;
		I = C0;

		// Reflectance term for m > 0 (pairs of diracs)
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {

			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;

		}

		// Since out of gamut colors might be produced, negative color values are clamped to 0.
		return max( I, vec3( 0.0 ) );

	}

`,Mn=`

	// See equation (2) in http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
	float velvetD( float cosThetaH, float roughness ) {

		float alpha = max( roughness, 0.07 );
		alpha = alpha * alpha;

		float invAlpha = 1.0 / alpha;

		float sqrCosThetaH = cosThetaH * cosThetaH;
		float sinThetaH = max( 1.0 - sqrCosThetaH, 0.001 );

		return ( 2.0 + invAlpha ) * pow( sinThetaH, 0.5 * invAlpha ) / ( 2.0 * PI );

	}

	float velvetParamsInterpolate( int i, float oneMinusAlphaSquared ) {

		const float p0[5] = float[5]( 25.3245, 3.32435, 0.16801, -1.27393, -4.85967 );
		const float p1[5] = float[5]( 21.5473, 3.82987, 0.19823, -1.97760, -4.32054 );

		return mix( p1[i], p0[i], oneMinusAlphaSquared );

	}

	float velvetL( float x, float alpha ) {

		float oneMinusAlpha = 1.0 - alpha;
		float oneMinusAlphaSquared = oneMinusAlpha * oneMinusAlpha;

		float a = velvetParamsInterpolate( 0, oneMinusAlphaSquared );
		float b = velvetParamsInterpolate( 1, oneMinusAlphaSquared );
		float c = velvetParamsInterpolate( 2, oneMinusAlphaSquared );
		float d = velvetParamsInterpolate( 3, oneMinusAlphaSquared );
		float e = velvetParamsInterpolate( 4, oneMinusAlphaSquared );

		return a / ( 1.0 + b * pow( abs( x ), c ) ) + d * x + e;

	}

	// See equation (3) in http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
	float velvetLambda( float cosTheta, float alpha ) {

		return abs( cosTheta ) < 0.5 ? exp( velvetL( cosTheta, alpha ) ) : exp( 2.0 * velvetL( 0.5, alpha ) - velvetL( 1.0 - cosTheta, alpha ) );

	}

	// See Section 3, Shadowing Term, in http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
	float velvetG( float cosThetaO, float cosThetaI, float roughness ) {

		float alpha = max( roughness, 0.07 );
		alpha = alpha * alpha;

		return 1.0 / ( 1.0 + velvetLambda( cosThetaO, alpha ) + velvetLambda( cosThetaI, alpha ) );

	}

	float directionalAlbedoSheen( float cosTheta, float alpha ) {

		cosTheta = saturate( cosTheta );

		float c = 1.0 - cosTheta;
		float c3 = c * c * c;

		return 0.65584461 * c3 + 1.0 / ( 4.16526551 + exp( -7.97291361 * sqrt( alpha ) + 6.33516894 ) );

	}

	float sheenAlbedoScaling( vec3 wo, vec3 wi, SurfaceRecord surf ) {

		float alpha = max( surf.sheenRoughness, 0.07 );
		alpha = alpha * alpha;

		float maxSheenColor = max( max( surf.sheenColor.r, surf.sheenColor.g ), surf.sheenColor.b );

		float eWo = directionalAlbedoSheen( saturateCos( wo.z ), alpha );
		float eWi = directionalAlbedoSheen( saturateCos( wi.z ), alpha );

		return min( 1.0 - maxSheenColor * eWo, 1.0 - maxSheenColor * eWi );

	}

	// See Section 5, Layering, in http://www.aconty.com/pdf/s2017_pbs_imageworks_sheen.pdf
	float sheenAlbedoScaling( vec3 wo, SurfaceRecord surf ) {

		float alpha = max( surf.sheenRoughness, 0.07 );
		alpha = alpha * alpha;

		float maxSheenColor = max( max( surf.sheenColor.r, surf.sheenColor.g ), surf.sheenColor.b );

		float eWo = directionalAlbedoSheen( saturateCos( wo.z ), alpha );

		return 1.0 - maxSheenColor * eWo;

	}

`,In=`

#ifndef FOG_CHECK_ITERATIONS
#define FOG_CHECK_ITERATIONS 30
#endif

// returns whether the given material is a fog material or not
bool isMaterialFogVolume( sampler2D materials, uint materialIndex ) {

	uint i = materialIndex * 45u;
	vec4 s14 = texelFetch1D( materials, i + 14u );
	return bool( int( s14.b ) & 4 );

}

// returns true if we're within the first fog volume we hit
bool bvhIntersectFogVolumeHit(
	vec3 rayOrigin, vec3 rayDirection,
	usampler2D materialIndexAttribute, sampler2D materials,
	inout Material material
) {

	material.fogVolume = false;

	for ( int i = 0; i < FOG_CHECK_ITERATIONS; i ++ ) {

		// find nearest hit
		uvec4 faceIndices = uvec4( 0u );
		vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
		vec3 barycoord = vec3( 0.0 );
		float side = 1.0;
		float dist = 0.0;
		bool hit = bvhIntersectFirstHit( bvh, rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist );
		if ( hit ) {

			// if it's a fog volume return whether we hit the front or back face
			uint materialIndex = uTexelFetch1D( materialIndexAttribute, faceIndices.x ).r;
			if ( isMaterialFogVolume( materials, materialIndex ) ) {

				material = readMaterialInfo( materials, materialIndex );
				return side == - 1.0;

			} else {

				// move the ray forward
				rayOrigin = stepRayOrigin( rayOrigin, rayDirection, - faceNormal, dist );

			}

		} else {

			return false;

		}

	}

	return false;

}

`,Rn=`

	// step through multiple surface hits and accumulate color attenuation based on transmissive surfaces
	// returns true if a solid surface was hit
	bool attenuateHit(
		RenderState state,
		Ray ray, float rayDist,
		out vec3 color
	) {

		// store the original bounce index so we can reset it after
		uint originalBounceIndex = sobolBounceIndex;

		int traversals = state.traversals;
		int transmissiveTraversals = state.transmissiveTraversals;
		bool isShadowRay = state.isShadowRay;
		Material fogMaterial = state.fogMaterial;

		vec3 startPoint = ray.origin;

		// hit results
		SurfaceHit surfaceHit;

		color = vec3( 1.0 );

		bool result = true;
		for ( int i = 0; i < traversals; i ++ ) {

			sobolBounceIndex ++;

			int hitType = traceScene( ray, fogMaterial, surfaceHit );

			if ( hitType == FOG_HIT ) {

				result = true;
				break;

			} else if ( hitType == SURFACE_HIT ) {

				float totalDist = distance( startPoint, ray.origin + ray.direction * surfaceHit.dist );
				if ( totalDist > rayDist ) {

					result = false;
					break;

				}

				// TODO: attenuate the contribution based on the PDF of the resulting ray including refraction values
				// Should be able to work using the material BSDF functions which will take into account specularity, etc.
				// TODO: should we account for emissive surfaces here?

				uint materialIndex = uTexelFetch1D( materialIndexAttribute, surfaceHit.faceIndices.x ).r;
				Material material = readMaterialInfo( materials, materialIndex );

				// adjust the ray to the new surface
				bool isEntering = surfaceHit.side == 1.0;
				ray.origin = stepRayOrigin( ray.origin, ray.direction, - surfaceHit.faceNormal, surfaceHit.dist );

				#if FEATURE_FOG

				if ( material.fogVolume ) {

					fogMaterial = material;
					fogMaterial.fogVolume = surfaceHit.side == 1.0;
					i -= sign( transmissiveTraversals );
					transmissiveTraversals --;
					continue;

				}

				#endif

				if ( ! material.castShadow && isShadowRay ) {

					continue;

				}

				vec2 uv = textureSampleBarycoord( attributesArray, ATTR_UV, surfaceHit.barycoord, surfaceHit.faceIndices.xyz ).xy;
				vec4 vertexColor = textureSampleBarycoord( attributesArray, ATTR_COLOR, surfaceHit.barycoord, surfaceHit.faceIndices.xyz );

				// albedo
				vec4 albedo = vec4( material.color, material.opacity );
				if ( material.map != - 1 ) {

					vec3 uvPrime = material.mapTransform * vec3( uv, 1 );
					albedo *= texture2D( textures, vec3( uvPrime.xy, material.map ) );

				}

				if ( material.vertexColors ) {

					albedo *= vertexColor;

				}

				// alphaMap
				if ( material.alphaMap != - 1 ) {

					albedo.a *= texture2D( textures, vec3( uv, material.alphaMap ) ).x;

				}

				// transmission
				float transmission = material.transmission;
				if ( material.transmissionMap != - 1 ) {

					vec3 uvPrime = material.transmissionMapTransform * vec3( uv, 1 );
					transmission *= texture2D( textures, vec3( uvPrime.xy, material.transmissionMap ) ).r;

				}

				// metalness
				float metalness = material.metalness;
				if ( material.metalnessMap != - 1 ) {

					vec3 uvPrime = material.metalnessMapTransform * vec3( uv, 1 );
					metalness *= texture2D( textures, vec3( uvPrime.xy, material.metalnessMap ) ).b;

				}

				float alphaTest = material.alphaTest;
				bool useAlphaTest = alphaTest != 0.0;
				float transmissionFactor = ( 1.0 - metalness ) * transmission;
				if (
					transmissionFactor < rand( 9 ) && ! (
						// material sidedness
						material.side != 0.0 && surfaceHit.side == material.side

						// alpha test
						|| useAlphaTest && albedo.a < alphaTest

						// opacity
						|| material.transparent && ! useAlphaTest && albedo.a < rand( 10 )
					)
				) {

					result = true;
					break;

				}

				if ( surfaceHit.side == 1.0 && isEntering ) {

					// only attenuate by surface color on the way in
					color *= mix( vec3( 1.0 ), albedo.rgb, transmissionFactor );

				} else if ( surfaceHit.side == - 1.0 ) {

					// attenuate by medium once we hit the opposite side of the model
					color *= transmissionAttenuation( surfaceHit.dist, material.attenuationColor, material.attenuationDistance );

				}

				bool isTransmissiveRay = dot( ray.direction, surfaceHit.faceNormal * surfaceHit.side ) < 0.0;
				if ( ( isTransmissiveRay || isEntering ) && transmissiveTraversals > 0 ) {

					i -= sign( transmissiveTraversals );
					transmissiveTraversals --;

				}

			} else {

				result = false;
				break;

			}

		}

		// reset the bounce index
		sobolBounceIndex = originalBounceIndex;
		return result;

	}

`,Pn=`

	vec3 ndcToRayOrigin( vec2 coord ) {

		vec4 rayOrigin4 = cameraWorldMatrix * invProjectionMatrix * vec4( coord, - 1.0, 1.0 );
		return rayOrigin4.xyz / rayOrigin4.w;
	}

	Ray getCameraRay() {

		vec2 ssd = vec2( 1.0 ) / resolution;

		// Jitter the camera ray by finding a uv coordinate at a random sample
		// around this pixel's UV coordinate for AA
		vec2 ruv = rand2( 0 );
		vec2 jitteredUv = vUv + vec2( tentFilter( ruv.x ) * ssd.x, tentFilter( ruv.y ) * ssd.y );
		Ray ray;

		#if CAMERA_TYPE == 2

			// Equirectangular projection
			vec4 rayDirection4 = vec4( equirectUvToDirection( jitteredUv ), 0.0 );
			vec4 rayOrigin4 = vec4( 0.0, 0.0, 0.0, 1.0 );

			rayDirection4 = cameraWorldMatrix * rayDirection4;
			rayOrigin4 = cameraWorldMatrix * rayOrigin4;

			ray.direction = normalize( rayDirection4.xyz );
			ray.origin = rayOrigin4.xyz / rayOrigin4.w;

		#else

			// get [- 1, 1] normalized device coordinates
			vec2 ndc = 2.0 * jitteredUv - vec2( 1.0 );
			ray.origin = ndcToRayOrigin( ndc );

			#if CAMERA_TYPE == 1

				// Orthographic projection
				ray.direction = ( cameraWorldMatrix * vec4( 0.0, 0.0, - 1.0, 0.0 ) ).xyz;
				ray.direction = normalize( ray.direction );

			#else

				// Perspective projection
				ray.direction = normalize( mat3( cameraWorldMatrix ) * ( invProjectionMatrix * vec4( ndc, 0.0, 1.0 ) ).xyz );

			#endif

		#endif

		#if FEATURE_DOF
		{

			// depth of field
			vec3 focalPoint = ray.origin + normalize( ray.direction ) * physicalCamera.focusDistance;

			// get the aperture sample
			// if blades === 0 then we assume a circle
			vec3 shapeUVW= rand3( 1 );
			int blades = physicalCamera.apertureBlades;
			float anamorphicRatio = physicalCamera.anamorphicRatio;
			vec2 apertureSample = blades == 0 ? sampleCircle( shapeUVW.xy ) : sampleRegularPolygon( blades, shapeUVW );
			apertureSample *= physicalCamera.bokehSize * 0.5 * 1e-3;

			// rotate the aperture shape
			apertureSample =
				rotateVector( apertureSample, physicalCamera.apertureRotation ) *
				saturate( vec2( anamorphicRatio, 1.0 / anamorphicRatio ) );

			// create the new ray
			ray.origin += ( cameraWorldMatrix * vec4( apertureSample, 0.0, 0.0 ) ).xyz;
			ray.direction = focalPoint - ray.origin;

		}
		#endif

		ray.direction = normalize( ray.direction );

		return ray;

	}

`,Cn=`

	vec3 directLightContribution( vec3 worldWo, SurfaceRecord surf, RenderState state, vec3 rayOrigin ) {

		vec3 result = vec3( 0.0 );

		// uniformly pick a light or environment map
		if( lightsDenom != 0.0 && rand( 5 ) < float( lights.count ) / lightsDenom ) {

			// sample a light or environment
			LightRecord lightRec = randomLightSample( lights.tex, iesProfiles, lights.count, rayOrigin, rand3( 6 ) );

			bool isSampleBelowSurface = ! surf.volumeParticle && dot( surf.faceNormal, lightRec.direction ) < 0.0;
			if ( isSampleBelowSurface ) {

				lightRec.pdf = 0.0;

			}

			// check if a ray could even reach the light area
			Ray lightRay;
			lightRay.origin = rayOrigin;
			lightRay.direction = lightRec.direction;
			vec3 attenuatedColor;
			if (
				lightRec.pdf > 0.0 &&
				isDirectionValid( lightRec.direction, surf.normal, surf.faceNormal ) &&
				! attenuateHit( state, lightRay, lightRec.dist, attenuatedColor )
			) {

				// get the material pdf
				vec3 sampleColor;
				float lightMaterialPdf = bsdfResult( worldWo, lightRec.direction, surf, sampleColor );
				bool isValidSampleColor = all( greaterThanEqual( sampleColor, vec3( 0.0 ) ) );
				if ( lightMaterialPdf > 0.0 && isValidSampleColor ) {

					// weight the direct light contribution
					float lightPdf = lightRec.pdf / lightsDenom;
					float misWeight = lightRec.type == SPOT_LIGHT_TYPE || lightRec.type == DIR_LIGHT_TYPE || lightRec.type == POINT_LIGHT_TYPE ? 1.0 : misHeuristic( lightPdf, lightMaterialPdf );
					result = attenuatedColor * lightRec.emission * state.throughputColor * sampleColor * misWeight / lightPdf;

				}

			}

		} else if ( envMapInfo.totalSum != 0.0 && environmentIntensity != 0.0 ) {

			// find a sample in the environment map to include in the contribution
			vec3 envColor, envDirection;
			float envPdf = sampleEquirectProbability( rand2( 7 ), envColor, envDirection );
			envDirection = invEnvRotation3x3 * envDirection;

			// this env sampling is not set up for transmissive sampling and yields overly bright
			// results so we ignore the sample in this case.
			// TODO: this should be improved but how? The env samples could traverse a few layers?
			bool isSampleBelowSurface = ! surf.volumeParticle && dot( surf.faceNormal, envDirection ) < 0.0;
			if ( isSampleBelowSurface ) {

				envPdf = 0.0;

			}

			// check if a ray could even reach the surface
			Ray envRay;
			envRay.origin = rayOrigin;
			envRay.direction = envDirection;
			vec3 attenuatedColor;
			if (
				envPdf > 0.0 &&
				isDirectionValid( envDirection, surf.normal, surf.faceNormal ) &&
				! attenuateHit( state, envRay, INFINITY, attenuatedColor )
			) {

				// get the material pdf
				vec3 sampleColor;
				float envMaterialPdf = bsdfResult( worldWo, envDirection, surf, sampleColor );
				bool isValidSampleColor = all( greaterThanEqual( sampleColor, vec3( 0.0 ) ) );
				if ( envMaterialPdf > 0.0 && isValidSampleColor ) {

					// weight the direct light contribution
					envPdf /= lightsDenom;
					float misWeight = misHeuristic( envPdf, envMaterialPdf );
					result = attenuatedColor * environmentIntensity * envColor * state.throughputColor * sampleColor * misWeight / envPdf;

				}

			}

		}

		// Function changed to have a single return statement to potentially help with crashes on Mac OS.
		// See issue #470
		return result;

	}

`,Fn=`

	#define SKIP_SURFACE 0
	#define HIT_SURFACE 1
	int getSurfaceRecord(
		Material material, SurfaceHit surfaceHit, sampler2DArray attributesArray,
		float accumulatedRoughness,
		inout SurfaceRecord surf
	) {

		if ( material.fogVolume ) {

			vec3 normal = vec3( 0, 0, 1 );

			SurfaceRecord fogSurface;
			fogSurface.volumeParticle = true;
			fogSurface.color = material.color;
			fogSurface.emission = material.emissiveIntensity * material.emissive;
			fogSurface.normal = normal;
			fogSurface.faceNormal = normal;
			fogSurface.clearcoatNormal = normal;

			surf = fogSurface;
			return HIT_SURFACE;

		}

		// uv coord for textures
		vec2 uv = textureSampleBarycoord( attributesArray, ATTR_UV, surfaceHit.barycoord, surfaceHit.faceIndices.xyz ).xy;
		vec4 vertexColor = textureSampleBarycoord( attributesArray, ATTR_COLOR, surfaceHit.barycoord, surfaceHit.faceIndices.xyz );

		// albedo
		vec4 albedo = vec4( material.color, material.opacity );
		if ( material.map != - 1 ) {

			vec3 uvPrime = material.mapTransform * vec3( uv, 1 );
			albedo *= texture2D( textures, vec3( uvPrime.xy, material.map ) );

		}

		if ( material.vertexColors ) {

			albedo *= vertexColor;

		}

		// alphaMap
		if ( material.alphaMap != - 1 ) {

			albedo.a *= texture2D( textures, vec3( uv, material.alphaMap ) ).x;

		}

		// possibly skip this sample if it's transparent, alpha test is enabled, or we hit the wrong material side
		// and it's single sided.
		// - alpha test is disabled when it === 0
		// - the material sidedness test is complicated because we want light to pass through the back side but still
		// be able to see the front side. This boolean checks if the side we hit is the front side on the first ray
		// and we're rendering the other then we skip it. Do the opposite on subsequent bounces to get incoming light.
		float alphaTest = material.alphaTest;
		bool useAlphaTest = alphaTest != 0.0;
		if (
			// material sidedness
			material.side != 0.0 && surfaceHit.side != material.side

			// alpha test
			|| useAlphaTest && albedo.a < alphaTest

			// opacity
			|| material.transparent && ! useAlphaTest && albedo.a < rand( 3 )
		) {

			return SKIP_SURFACE;

		}

		// fetch the interpolated smooth normal
		vec3 normal = normalize( textureSampleBarycoord(
			attributesArray,
			ATTR_NORMAL,
			surfaceHit.barycoord,
			surfaceHit.faceIndices.xyz
		).xyz );

		// roughness
		float roughness = material.roughness;
		if ( material.roughnessMap != - 1 ) {

			vec3 uvPrime = material.roughnessMapTransform * vec3( uv, 1 );
			roughness *= texture2D( textures, vec3( uvPrime.xy, material.roughnessMap ) ).g;

		}

		// metalness
		float metalness = material.metalness;
		if ( material.metalnessMap != - 1 ) {

			vec3 uvPrime = material.metalnessMapTransform * vec3( uv, 1 );
			metalness *= texture2D( textures, vec3( uvPrime.xy, material.metalnessMap ) ).b;

		}

		// emission
		vec3 emission = material.emissiveIntensity * material.emissive;
		if ( material.emissiveMap != - 1 ) {

			vec3 uvPrime = material.emissiveMapTransform * vec3( uv, 1 );
			emission *= texture2D( textures, vec3( uvPrime.xy, material.emissiveMap ) ).xyz;

		}

		// transmission
		float transmission = material.transmission;
		if ( material.transmissionMap != - 1 ) {

			vec3 uvPrime = material.transmissionMapTransform * vec3( uv, 1 );
			transmission *= texture2D( textures, vec3( uvPrime.xy, material.transmissionMap ) ).r;

		}

		// normal
		if ( material.flatShading ) {

			// if we're rendering a flat shaded object then use the face normals - the face normal
			// is provided based on the side the ray hits the mesh so flip it to align with the
			// interpolated vertex normals.
			normal = surfaceHit.faceNormal * surfaceHit.side;

		}

		vec3 baseNormal = normal;
		if ( material.normalMap != - 1 ) {

			vec4 tangentSample = textureSampleBarycoord(
				attributesArray,
				ATTR_TANGENT,
				surfaceHit.barycoord,
				surfaceHit.faceIndices.xyz
			);

			// some provided tangents can be malformed (0, 0, 0) causing the normal to be degenerate
			// resulting in NaNs and slow path tracing.
			if ( length( tangentSample.xyz ) > 0.0 ) {

				vec3 tangent = normalize( tangentSample.xyz );
				vec3 bitangent = normalize( cross( normal, tangent ) * tangentSample.w );
				mat3 vTBN = mat3( tangent, bitangent, normal );

				vec3 uvPrime = material.normalMapTransform * vec3( uv, 1 );
				vec3 texNormal = texture2D( textures, vec3( uvPrime.xy, material.normalMap ) ).xyz * 2.0 - 1.0;
				texNormal.xy *= material.normalScale;
				normal = vTBN * texNormal;

			}

		}

		normal *= surfaceHit.side;

		// clearcoat
		float clearcoat = material.clearcoat;
		if ( material.clearcoatMap != - 1 ) {

			vec3 uvPrime = material.clearcoatMapTransform * vec3( uv, 1 );
			clearcoat *= texture2D( textures, vec3( uvPrime.xy, material.clearcoatMap ) ).r;

		}

		// clearcoatRoughness
		float clearcoatRoughness = material.clearcoatRoughness;
		if ( material.clearcoatRoughnessMap != - 1 ) {

			vec3 uvPrime = material.clearcoatRoughnessMapTransform * vec3( uv, 1 );
			clearcoatRoughness *= texture2D( textures, vec3( uvPrime.xy, material.clearcoatRoughnessMap ) ).g;

		}

		// clearcoatNormal
		vec3 clearcoatNormal = baseNormal;
		if ( material.clearcoatNormalMap != - 1 ) {

			vec4 tangentSample = textureSampleBarycoord(
				attributesArray,
				ATTR_TANGENT,
				surfaceHit.barycoord,
				surfaceHit.faceIndices.xyz
			);

			// some provided tangents can be malformed (0, 0, 0) causing the normal to be degenerate
			// resulting in NaNs and slow path tracing.
			if ( length( tangentSample.xyz ) > 0.0 ) {

				vec3 tangent = normalize( tangentSample.xyz );
				vec3 bitangent = normalize( cross( clearcoatNormal, tangent ) * tangentSample.w );
				mat3 vTBN = mat3( tangent, bitangent, clearcoatNormal );

				vec3 uvPrime = material.clearcoatNormalMapTransform * vec3( uv, 1 );
				vec3 texNormal = texture2D( textures, vec3( uvPrime.xy, material.clearcoatNormalMap ) ).xyz * 2.0 - 1.0;
				texNormal.xy *= material.clearcoatNormalScale;
				clearcoatNormal = vTBN * texNormal;

			}

		}

		clearcoatNormal *= surfaceHit.side;

		// sheenColor
		vec3 sheenColor = material.sheenColor;
		if ( material.sheenColorMap != - 1 ) {

			vec3 uvPrime = material.sheenColorMapTransform * vec3( uv, 1 );
			sheenColor *= texture2D( textures, vec3( uvPrime.xy, material.sheenColorMap ) ).rgb;

		}

		// sheenRoughness
		float sheenRoughness = material.sheenRoughness;
		if ( material.sheenRoughnessMap != - 1 ) {

			vec3 uvPrime = material.sheenRoughnessMapTransform * vec3( uv, 1 );
			sheenRoughness *= texture2D( textures, vec3( uvPrime.xy, material.sheenRoughnessMap ) ).a;

		}

		// iridescence
		float iridescence = material.iridescence;
		if ( material.iridescenceMap != - 1 ) {

			vec3 uvPrime = material.iridescenceMapTransform * vec3( uv, 1 );
			iridescence *= texture2D( textures, vec3( uvPrime.xy, material.iridescenceMap ) ).r;

		}

		// iridescence thickness
		float iridescenceThickness = material.iridescenceThicknessMaximum;
		if ( material.iridescenceThicknessMap != - 1 ) {

			vec3 uvPrime = material.iridescenceThicknessMapTransform * vec3( uv, 1 );
			float iridescenceThicknessSampled = texture2D( textures, vec3( uvPrime.xy, material.iridescenceThicknessMap ) ).g;
			iridescenceThickness = mix( material.iridescenceThicknessMinimum, material.iridescenceThicknessMaximum, iridescenceThicknessSampled );

		}

		iridescence = iridescenceThickness == 0.0 ? 0.0 : iridescence;

		// specular color
		vec3 specularColor = material.specularColor;
		if ( material.specularColorMap != - 1 ) {

			vec3 uvPrime = material.specularColorMapTransform * vec3( uv, 1 );
			specularColor *= texture2D( textures, vec3( uvPrime.xy, material.specularColorMap ) ).rgb;

		}

		// specular intensity
		float specularIntensity = material.specularIntensity;
		if ( material.specularIntensityMap != - 1 ) {

			vec3 uvPrime = material.specularIntensityMapTransform * vec3( uv, 1 );
			specularIntensity *= texture2D( textures, vec3( uvPrime.xy, material.specularIntensityMap ) ).a;

		}

		surf.volumeParticle = false;

		surf.faceNormal = surfaceHit.faceNormal;
		surf.normal = normal;

		surf.metalness = metalness;
		surf.color = albedo.rgb;
		surf.emission = emission;

		surf.ior = material.ior;
		surf.transmission = transmission;
		surf.thinFilm = material.thinFilm;
		surf.attenuationColor = material.attenuationColor;
		surf.attenuationDistance = material.attenuationDistance;

		surf.clearcoatNormal = clearcoatNormal;
		surf.clearcoat = clearcoat;

		surf.sheen = material.sheen;
		surf.sheenColor = sheenColor;

		surf.iridescence = iridescence;
		surf.iridescenceIor = material.iridescenceIor;
		surf.iridescenceThickness = iridescenceThickness;

		surf.specularColor = specularColor;
		surf.specularIntensity = specularIntensity;

		// apply perceptual roughness factor from gltf. sheen perceptual roughness is
		// applied by its brdf function
		// https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#microfacet-surfaces
		surf.roughness = roughness * roughness;
		surf.clearcoatRoughness = clearcoatRoughness * clearcoatRoughness;
		surf.sheenRoughness = sheenRoughness;

		// frontFace is used to determine transmissive properties and PDF. If no transmission is used
		// then we can just always assume this is a front face.
		surf.frontFace = surfaceHit.side == 1.0 || transmission == 0.0;
		surf.eta = material.thinFilm || surf.frontFace ? 1.0 / material.ior : material.ior;
		surf.f0 = iorRatioToF0( surf.eta );

		// Compute the filtered roughness value to use during specular reflection computations.
		// The accumulated roughness value is scaled by a user setting and a "magic value" of 5.0.
		// If we're exiting something transmissive then scale the factor down significantly so we can retain
		// sharp internal reflections
		surf.filteredRoughness = applyFilteredGlossy( surf.roughness, accumulatedRoughness );
		surf.filteredClearcoatRoughness = applyFilteredGlossy( surf.clearcoatRoughness, accumulatedRoughness );

		// get the normal frames
		surf.normalBasis = getBasisFromNormal( surf.normal );
		surf.normalInvBasis = inverse( surf.normalBasis );

		surf.clearcoatBasis = getBasisFromNormal( surf.clearcoatNormal );
		surf.clearcoatInvBasis = inverse( surf.clearcoatBasis );

		return HIT_SURFACE;

	}
`,Dn=`

	struct Ray {

		vec3 origin;
		vec3 direction;

	};

	struct SurfaceHit {

		uvec4 faceIndices;
		vec3 barycoord;
		vec3 faceNormal;
		float side;
		float dist;

	};

	struct RenderState {

		bool firstRay;
		bool transmissiveRay;
		bool isShadowRay;
		float accumulatedRoughness;
		int transmissiveTraversals;
		int traversals;
		uint depth;
		vec3 throughputColor;
		Material fogMaterial;

	};

	RenderState initRenderState() {

		RenderState result;
		result.firstRay = true;
		result.transmissiveRay = true;
		result.isShadowRay = false;
		result.accumulatedRoughness = 0.0;
		result.transmissiveTraversals = 0;
		result.traversals = 0;
		result.throughputColor = vec3( 1.0 );
		result.depth = 0u;
		result.fogMaterial.fogVolume = false;
		return result;

	}

`,En=`

	#define NO_HIT 0
	#define SURFACE_HIT 1
	#define LIGHT_HIT 2
	#define FOG_HIT 3

	// Passing the global variable 'lights' into this function caused shader program errors.
	// So global variables like 'lights' and 'bvh' were moved out of the function parameters.
	// For more information, refer to: https://github.com/gkjohnson/three-gpu-pathtracer/pull/457
	int traceScene(
		Ray ray, Material fogMaterial, inout SurfaceHit surfaceHit
	) {

		int result = NO_HIT;
		bool hit = bvhIntersectFirstHit( bvh, ray.origin, ray.direction, surfaceHit.faceIndices, surfaceHit.faceNormal, surfaceHit.barycoord, surfaceHit.side, surfaceHit.dist );

		#if FEATURE_FOG

		if ( fogMaterial.fogVolume ) {

			// offset the distance so we don't run into issues with particles on the same surface
			// as other objects
			float particleDist = intersectFogVolume( fogMaterial, rand( 1 ) );
			if ( particleDist + RAY_OFFSET < surfaceHit.dist ) {

				surfaceHit.side = 1.0;
				surfaceHit.faceNormal = normalize( - ray.direction );
				surfaceHit.dist = particleDist;
				return FOG_HIT;

			}

		}

		#endif

		if ( hit ) {

			result = SURFACE_HIT;

		}

		return result;

	}

`;class Bn extends mi{onBeforeRender(){this.setDefine("FEATURE_DOF",this.physicalCamera.bokehSize===0?0:1),this.setDefine("FEATURE_BACKGROUND_MAP",this.backgroundMap?1:0),this.setDefine("FEATURE_FOG",this.materials.features.isUsed("FOG")?1:0)}constructor(e){super({transparent:!0,depthWrite:!1,defines:{FEATURE_MIS:1,FEATURE_RUSSIAN_ROULETTE:1,FEATURE_DOF:1,FEATURE_BACKGROUND_MAP:0,FEATURE_FOG:1,RANDOM_TYPE:2,CAMERA_TYPE:0,DEBUG_MODE:0,ATTR_NORMAL:0,ATTR_TANGENT:1,ATTR_UV:2,ATTR_COLOR:3},uniforms:{resolution:{value:new Y},opacity:{value:1},bounces:{value:10},transmissiveBounces:{value:10},filterGlossyFactor:{value:0},physicalCamera:{value:new Pa},cameraWorldMatrix:{value:new L},invProjectionMatrix:{value:new L},bvh:{value:new Js},attributesArray:{value:new Ua},materialIndexAttribute:{value:new xr},materials:{value:new ja},textures:{value:new qi().texture},lights:{value:new Ha},iesProfiles:{value:new qi(360,180,{type:ae,wrapS:xe,wrapT:xe}).texture},environmentIntensity:{value:1},environmentRotation:{value:new L},envMapInfo:{value:new Da},backgroundBlur:{value:0},backgroundMap:{value:null},backgroundAlpha:{value:1},backgroundIntensity:{value:1},backgroundRotation:{value:new L},seed:{value:0},sobolTexture:{value:null},stratifiedTexture:{value:new tn},stratifiedOffsetTexture:{value:new cn(64,1)}},vertexShader:`

				varying vec2 vUv;
				void main() {

					vec4 mvPosition = vec4( position, 1.0 );
					mvPosition = modelViewMatrix * mvPosition;
					gl_Position = projectionMatrix * mvPosition;

					vUv = uv;

				}

			`,fragmentShader:`
				#define RAY_OFFSET 1e-4
				#define INFINITY 1e20

				precision highp isampler2D;
				precision highp usampler2D;
				precision highp sampler2DArray;
				vec4 envMapTexelToLinear( vec4 a ) { return a; }
				#include <common>

				// bvh intersection
				${ia}
				${sa}
				${ra}

				// uniform structs
				${ln}
				${fn}
				${un}
				${hn}
				${dn}

				// random
				#if RANDOM_TYPE == 2 	// Stratified List

					${Tn}

				#elif RANDOM_TYPE == 1 	// Sobol

					${$i}
					${Sr}
					${Ma}

					#define rand(v) sobol(v)
					#define rand2(v) sobol2(v)
					#define rand3(v) sobol3(v)
					#define rand4(v) sobol4(v)

				#else 					// PCG

				${$i}

					// Using the sobol functions seems to break the the compiler on MacOS
					// - specifically the "sobolReverseBits" function.
					uint sobolPixelIndex = 0u;
					uint sobolPathIndex = 0u;
					uint sobolBounceIndex = 0u;

					#define rand(v) pcgRand()
					#define rand2(v) pcgRand2()
					#define rand3(v) pcgRand3()
					#define rand4(v) pcgRand4()

				#endif

				// common
				${bn}
				${vn}
				${Mr}
				${xn}
				${yn}

				// environment
				uniform EquirectHdrInfo envMapInfo;
				uniform mat4 environmentRotation;
				uniform float environmentIntensity;

				// lighting
				uniform sampler2DArray iesProfiles;
				uniform LightsInfo lights;

				// background
				uniform float backgroundBlur;
				uniform float backgroundAlpha;
				#if FEATURE_BACKGROUND_MAP

				uniform sampler2D backgroundMap;
				uniform mat4 backgroundRotation;
				uniform float backgroundIntensity;

				#endif

				// camera
				uniform mat4 cameraWorldMatrix;
				uniform mat4 invProjectionMatrix;
				#if FEATURE_DOF

				uniform PhysicalCamera physicalCamera;

				#endif

				// geometry
				uniform sampler2DArray attributesArray;
				uniform usampler2D materialIndexAttribute;
				uniform sampler2D materials;
				uniform sampler2DArray textures;
				uniform BVH bvh;

				// path tracer
				uniform int bounces;
				uniform int transmissiveBounces;
				uniform float filterGlossyFactor;
				uniform int seed;

				// image
				uniform vec2 resolution;
				uniform float opacity;

				varying vec2 vUv;

				// globals
				mat3 envRotation3x3;
				mat3 invEnvRotation3x3;
				float lightsDenom;

				// sampling
				${gn}
				${mn}
				${pn}

				${In}
				${_n}
				${Mn}
				${An}
				${Sn}
				${wn}

				float applyFilteredGlossy( float roughness, float accumulatedRoughness ) {

					return clamp(
						max(
							roughness,
							accumulatedRoughness * filterGlossyFactor * 5.0 ),
						0.0,
						1.0
					);

				}

				vec3 sampleBackground( vec3 direction, vec2 uv ) {

					vec3 sampleDir = sampleHemisphere( direction, uv ) * 0.5 * backgroundBlur;

					#if FEATURE_BACKGROUND_MAP

					sampleDir = normalize( mat3( backgroundRotation ) * direction + sampleDir );
					return backgroundIntensity * sampleEquirectColor( backgroundMap, sampleDir );

					#else

					sampleDir = normalize( envRotation3x3 * direction + sampleDir );
					return environmentIntensity * sampleEquirectColor( envMapInfo.map, sampleDir );

					#endif

				}

				${Dn}
				${Pn}
				${En}
				${Rn}
				${Cn}
				${Fn}

				void main() {

					// init
					rng_initialize( gl_FragCoord.xy, seed );
					sobolPixelIndex = ( uint( gl_FragCoord.x ) << 16 ) | uint( gl_FragCoord.y );
					sobolPathIndex = uint( seed );

					// get camera ray
					Ray ray = getCameraRay();

					// inverse environment rotation
					envRotation3x3 = mat3( environmentRotation );
					invEnvRotation3x3 = inverse( envRotation3x3 );
					lightsDenom =
						( environmentIntensity == 0.0 || envMapInfo.totalSum == 0.0 ) && lights.count != 0u ?
							float( lights.count ) :
							float( lights.count + 1u );

					// final color
					gl_FragColor = vec4( 0, 0, 0, 1 );

					// surface results
					SurfaceHit surfaceHit;
					ScatterRecord scatterRec;

					// path tracing state
					RenderState state = initRenderState();
					state.transmissiveTraversals = transmissiveBounces;
					#if FEATURE_FOG

					state.fogMaterial.fogVolume = bvhIntersectFogVolumeHit(
						ray.origin, - ray.direction,
						materialIndexAttribute, materials,
						state.fogMaterial
					);

					#endif

					for ( int i = 0; i < bounces; i ++ ) {

						sobolBounceIndex ++;

						state.depth ++;
						state.traversals = bounces - i;
						state.firstRay = i == 0 && state.transmissiveTraversals == transmissiveBounces;

						int hitType = traceScene( ray, state.fogMaterial, surfaceHit );

						// check if we intersect any lights and accumulate the light contribution
						// TODO: we can add support for light surface rendering in the else condition if we
						// add the ability to toggle visibility of the the light
						if ( ! state.firstRay && ! state.transmissiveRay ) {

							LightRecord lightRec;
							float lightDist = hitType == NO_HIT ? INFINITY : surfaceHit.dist;
							for ( uint i = 0u; i < lights.count; i ++ ) {

								if (
									intersectLightAtIndex( lights.tex, ray.origin, ray.direction, i, lightRec ) &&
									lightRec.dist < lightDist
								) {

									#if FEATURE_MIS

									// weight the contribution
									// NOTE: Only area lights are supported for forward sampling and can be hit
									float misWeight = misHeuristic( scatterRec.pdf, lightRec.pdf / lightsDenom );
									gl_FragColor.rgb += lightRec.emission * state.throughputColor * misWeight;

									#else

									gl_FragColor.rgb += lightRec.emission * state.throughputColor;

									#endif

								}

							}

						}

						if ( hitType == NO_HIT ) {

							if ( state.firstRay || state.transmissiveRay ) {

								gl_FragColor.rgb += sampleBackground( ray.direction, rand2( 2 ) ) * state.throughputColor;
								gl_FragColor.a = backgroundAlpha;

							} else {

								#if FEATURE_MIS

								// get the PDF of the hit envmap point
								vec3 envColor;
								float envPdf = sampleEquirect( envRotation3x3 * ray.direction, envColor );
								envPdf /= lightsDenom;

								// and weight the contribution
								float misWeight = misHeuristic( scatterRec.pdf, envPdf );
								gl_FragColor.rgb += environmentIntensity * envColor * state.throughputColor * misWeight;

								#else

								gl_FragColor.rgb +=
									environmentIntensity *
									sampleEquirectColor( envMapInfo.map, envRotation3x3 * ray.direction ) *
									state.throughputColor;

								#endif

							}
							break;

						}

						uint materialIndex = uTexelFetch1D( materialIndexAttribute, surfaceHit.faceIndices.x ).r;
						Material material = readMaterialInfo( materials, materialIndex );

						#if FEATURE_FOG

						if ( hitType == FOG_HIT ) {

							material = state.fogMaterial;
							state.accumulatedRoughness += 0.2;

						} else if ( material.fogVolume ) {

							state.fogMaterial = material;
							state.fogMaterial.fogVolume = surfaceHit.side == 1.0;

							ray.origin = stepRayOrigin( ray.origin, ray.direction, - surfaceHit.faceNormal, surfaceHit.dist );

							i -= sign( state.transmissiveTraversals );
							state.transmissiveTraversals -= sign( state.transmissiveTraversals );
							continue;

						}

						#endif

						// early out if this is a matte material
						if ( material.matte && state.firstRay ) {

							gl_FragColor = vec4( 0.0 );
							break;

						}

						// if we've determined that this is a shadow ray and we've hit an item with no shadow casting
						// then skip it
						if ( ! material.castShadow && state.isShadowRay ) {

							ray.origin = stepRayOrigin( ray.origin, ray.direction, - surfaceHit.faceNormal, surfaceHit.dist );
							continue;

						}

						SurfaceRecord surf;
						if (
							getSurfaceRecord(
								material, surfaceHit, attributesArray, state.accumulatedRoughness,
								surf
							) == SKIP_SURFACE
						) {

							// only allow a limited number of transparency discards otherwise we could
							// crash the context with too long a loop.
							i -= sign( state.transmissiveTraversals );
							state.transmissiveTraversals -= sign( state.transmissiveTraversals );

							ray.origin = stepRayOrigin( ray.origin, ray.direction, - surfaceHit.faceNormal, surfaceHit.dist );
							continue;

						}

						scatterRec = bsdfSample( - ray.direction, surf );
						state.isShadowRay = scatterRec.specularPdf < rand( 4 );

						bool isBelowSurface = ! surf.volumeParticle && dot( scatterRec.direction, surf.faceNormal ) < 0.0;
						vec3 hitPoint = stepRayOrigin( ray.origin, ray.direction, isBelowSurface ? - surf.faceNormal : surf.faceNormal, surfaceHit.dist );

						// next event estimation
						#if FEATURE_MIS

						gl_FragColor.rgb += directLightContribution( - ray.direction, surf, state, hitPoint );

						#endif

						// accumulate a roughness value to offset diffuse, specular, diffuse rays that have high contribution
						// to a single pixel resulting in fireflies
						// TODO: handle transmissive surfaces
						if ( ! surf.volumeParticle && ! isBelowSurface ) {

							// determine if this is a rough normal or not by checking how far off straight up it is
							vec3 halfVector = normalize( - ray.direction + scatterRec.direction );
							state.accumulatedRoughness += max(
								sin( acosApprox( dot( halfVector, surf.normal ) ) ),
								sin( acosApprox( dot( halfVector, surf.clearcoatNormal ) ) )
							);

							state.transmissiveRay = false;

						}

						// accumulate emissive color
						gl_FragColor.rgb += ( surf.emission * state.throughputColor );

						// skip the sample if our PDF or ray is impossible
						if ( scatterRec.pdf <= 0.0 || ! isDirectionValid( scatterRec.direction, surf.normal, surf.faceNormal ) ) {

							break;

						}

						// if we're bouncing around the inside a transmissive material then decrement
						// perform this separate from a bounce
						bool isTransmissiveRay = ! surf.volumeParticle && dot( scatterRec.direction, surf.faceNormal * surfaceHit.side ) < 0.0;
						if ( ( isTransmissiveRay || isBelowSurface ) && state.transmissiveTraversals > 0 ) {

							state.transmissiveTraversals --;
							i --;

						}

						//

						// handle throughput color transformation
						// attenuate the throughput color by the medium color
						if ( ! surf.frontFace ) {

							state.throughputColor *= transmissionAttenuation( surfaceHit.dist, surf.attenuationColor, surf.attenuationDistance );

						}

						#if FEATURE_RUSSIAN_ROULETTE

						// russian roulette path termination
						// https://www.arnoldrenderer.com/research/physically_based_shader_design_in_arnold.pdf
						uint minBounces = 3u;
						float depthProb = float( state.depth < minBounces );

						float rrProb = luminance( state.throughputColor * scatterRec.color / scatterRec.pdf );
						rrProb /= luminance( state.throughputColor );
						rrProb = sqrt( rrProb );
						rrProb = max( rrProb, depthProb );
						rrProb = min( rrProb, 1.0 );
						if ( rand( 8 ) > rrProb ) {

							break;

						}

						// perform sample clamping here to avoid bright pixels
						state.throughputColor *= min( 1.0 / rrProb, 20.0 );

						#endif

						// adjust the throughput and discard and exit if we find discard the sample if there are any NaNs
						state.throughputColor *= scatterRec.color / scatterRec.pdf;
						if ( any( isnan( state.throughputColor ) ) || any( isinf( state.throughputColor ) ) ) {

							break;

						}

						//

						// prepare for next ray
						ray.direction = scatterRec.direction;
						ray.origin = hitPoint;

					}

					gl_FragColor.a *= opacity;

					#if DEBUG_MODE == 1

					// output the number of rays checked in the path and number of
					// transmissive rays encountered.
					gl_FragColor.rgb = vec3(
						float( state.depth ),
						transmissiveBounces - state.transmissiveTraversals,
						0.0
					);
					gl_FragColor.a = 1.0;

					#endif

				}

			`}),this.setValues(e)}}function*zn(){const{_renderer:s,_fsQuad:e,_blendQuad:t,_primaryTarget:i,_blendTargets:a,_sobolTarget:n,_subframe:r,alpha:c,material:l}=this,h=new Le,f=new Le,u=t.material;let[o,m]=a;for(;;){c?(u.opacity=this._opacityFactor/(this.samples+1),l.blending=it,l.opacity=1):(l.opacity=this._opacityFactor/(this.samples+1),l.blending=ci);const[g,x,d,p]=r,v=i.width,y=i.height;l.resolution.set(v*d,y*p),l.sobolTexture=n.texture,l.stratifiedTexture.init(20,l.bounces+l.transmissiveBounces+5),l.stratifiedTexture.next(),l.seed++;const T=this.tiles.x||1,b=this.tiles.y||1,S=T*b,w=Math.ceil(v*d),A=Math.ceil(y*p),_=Math.floor(g*v),I=Math.floor(x*y),R=Math.ceil(w/T),M=Math.ceil(A/b);for(let P=0;P<b;P++)for(let C=0;C<T;C++){const D=s.getRenderTarget(),E=s.autoClear,W=s.getScissorTest();s.getScissor(h),s.getViewport(f);let X=C,fe=P;if(!this.stableTiles){const Pt=this._currentTile%(T*b);X=Pt%T,fe=~~(Pt/T),this._currentTile=Pt+1}const gi=b-fe-1;i.scissor.set(_+X*R,I+gi*M,Math.min(R,w-X*R),Math.min(M,A-gi*M)),i.viewport.set(_,I,w,A),s.setRenderTarget(i),s.setScissorTest(!0),s.autoClear=!1,e.render(s),s.setViewport(f),s.setScissor(h),s.setScissorTest(W),s.setRenderTarget(D),s.autoClear=E,c&&(u.target1=o.texture,u.target2=i.texture,s.setRenderTarget(m),t.render(s),s.setRenderTarget(D)),this.samples+=1/S,C===T-1&&P===b-1&&(this.samples=Math.round(this.samples)),yield}[o,m]=[m,o]}}const ji=new Ue;class Yi{get material(){return this._fsQuad.material}set material(e){this._fsQuad.material.removeEventListener("recompilation",this._compileFunction),e.addEventListener("recompilation",this._compileFunction),this._fsQuad.material=e}get target(){return this._alpha?this._blendTargets[1]:this._primaryTarget}set alpha(e){this._alpha!==e&&(e||(this._blendTargets[0].dispose(),this._blendTargets[1].dispose()),this._alpha=e,this.reset())}get alpha(){return this._alpha}get isCompiling(){return!!this._compilePromise}constructor(e){this.camera=null,this.tiles=new Y(3,3),this.stableNoise=!1,this.stableTiles=!0,this.samples=0,this._subframe=new Le(0,0,1,1),this._opacityFactor=1,this._renderer=e,this._alpha=!1,this._fsQuad=new _e(new Bn),this._blendQuad=new _e(new _a),this._task=null,this._currentTile=0,this._compilePromise=null,this._sobolTarget=new Ra().generate(e),this._primaryTarget=new et(1,1,{format:U,type:V,magFilter:O,minFilter:O}),this._blendTargets=[new et(1,1,{format:U,type:V,magFilter:O,minFilter:O}),new et(1,1,{format:U,type:V,magFilter:O,minFilter:O})],this._compileFunction=()=>{const t=this.compileMaterial(this._fsQuad._mesh);t.then(()=>{this._compilePromise===t&&(this._compilePromise=null)}),this._compilePromise=t},this.material.addEventListener("recompilation",this._compileFunction)}compileMaterial(){return this._renderer.compileAsync(this._fsQuad._mesh)}setCamera(e){const{material:t}=this;t.cameraWorldMatrix.copy(e.matrixWorld),t.invProjectionMatrix.copy(e.projectionMatrixInverse),t.physicalCamera.updateFrom(e);let i=0;e.projectionMatrix.elements[15]>0&&(i=1),e.isEquirectCamera&&(i=2),t.setDefine("CAMERA_TYPE",i),this.camera=e}setSize(e,t){e=Math.ceil(e),t=Math.ceil(t),!(this._primaryTarget.width===e&&this._primaryTarget.height===t)&&(this._primaryTarget.setSize(e,t),this._blendTargets[0].setSize(e,t),this._blendTargets[1].setSize(e,t),this.reset())}getSize(e){e.x=this._primaryTarget.width,e.y=this._primaryTarget.height}dispose(){this._primaryTarget.dispose(),this._blendTargets[0].dispose(),this._blendTargets[1].dispose(),this._sobolTarget.dispose(),this._fsQuad.dispose(),this._blendQuad.dispose(),this._task=null}reset(){const{_renderer:e,_primaryTarget:t,_blendTargets:i}=this,a=e.getRenderTarget(),n=e.getClearAlpha();e.getClearColor(ji),e.setRenderTarget(t),e.setClearColor(0,0),e.clearColor(),e.setRenderTarget(i[0]),e.setClearColor(0,0),e.clearColor(),e.setRenderTarget(i[1]),e.setClearColor(0,0),e.clearColor(),e.setClearColor(ji,n),e.setRenderTarget(a),this.samples=0,this._task=null,this.material.stratifiedTexture.stableNoise=this.stableNoise,this.stableNoise&&(this.material.seed=0,this.material.stratifiedTexture.reset())}update(){this.material.onBeforeRender(),!this.isCompiling&&(this._task||(this._task=zn.call(this)),this._task.next())}}const Se=new Y,Xi=new Y,wt=new Ur,St=new Ue;class kn extends ee{constructor(e=512,t=512){super(new Float32Array(e*t*4),e,t,U,V,cr,pe,xe,re,re),this.generationCallback=null}update(){this.dispose(),this.needsUpdate=!0;const{data:e,width:t,height:i}=this.image;for(let a=0;a<t;a++)for(let n=0;n<i;n++){Xi.set(t,i),Se.set(a/t,n/i),Se.x-=.5,Se.y=1-Se.y,wt.theta=Se.x*2*Math.PI,wt.phi=Se.y*Math.PI,wt.radius=1,this.generationCallback(wt,Se,Xi,St);const c=4*(n*t+a);e[c+0]=St.r,e[c+1]=St.g,e[c+2]=St.b,e[c+3]=1}}copy(e){return super.copy(e),this.generationCallback=e.generationCallback,this}}const Qi=new F;class On extends kn{constructor(e=512){super(e,e),this.topColor=new Ue().set(16777215),this.bottomColor=new Ue().set(0),this.exponent=2,this.generationCallback=(t,i,a,n)=>{Qi.setFromSpherical(t);const r=Qi.y*.5+.5;n.lerpColors(this.bottomColor,this.topColor,r**this.exponent)}}copy(e){return super.copy(e),this.topColor.copy(e.topColor),this.bottomColor.copy(e.bottomColor),this}}class Nn extends rt{get map(){return this.uniforms.map.value}set map(e){this.uniforms.map.value=e}get opacity(){return this.uniforms.opacity.value}set opacity(e){this.uniforms&&(this.uniforms.opacity.value=e)}constructor(e){super({uniforms:{map:{value:null},opacity:{value:1}},vertexShader:`
				varying vec2 vUv;
				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}
			`,fragmentShader:`
				uniform sampler2D map;
				uniform float opacity;
				varying vec2 vUv;

				vec4 clampedTexelFatch( sampler2D map, ivec2 px, int lod ) {

					vec4 res = texelFetch( map, ivec2( px.x, px.y ), 0 );

					#if defined( TONE_MAPPING )

					res.xyz = toneMapping( res.xyz );

					#endif

			  		return linearToOutputTexel( res );

				}

				void main() {

					vec2 size = vec2( textureSize( map, 0 ) );
					vec2 pxUv = vUv * size;
					vec2 pxCurr = floor( pxUv );
					vec2 pxFrac = fract( pxUv ) - 0.5;
					vec2 pxOffset;
					pxOffset.x = pxFrac.x > 0.0 ? 1.0 : - 1.0;
					pxOffset.y = pxFrac.y > 0.0 ? 1.0 : - 1.0;

					vec2 pxNext = clamp( pxOffset + pxCurr, vec2( 0.0 ), size - 1.0 );
					vec2 alpha = abs( pxFrac );

					vec4 p1 = mix(
						clampedTexelFatch( map, ivec2( pxCurr.x, pxCurr.y ), 0 ),
						clampedTexelFatch( map, ivec2( pxNext.x, pxCurr.y ), 0 ),
						alpha.x
					);

					vec4 p2 = mix(
						clampedTexelFatch( map, ivec2( pxCurr.x, pxNext.y ), 0 ),
						clampedTexelFatch( map, ivec2( pxNext.x, pxNext.y ), 0 ),
						alpha.x
					);

					gl_FragColor = mix( p1, p2, alpha.y );
					gl_FragColor.a *= opacity;
					#include <premultiplied_alpha_fragment>

				}
			`}),this.setValues(e)}}class Hn extends rt{constructor(){super({uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:`
				varying vec2 vUv;
				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}`,fragmentShader:`
				#define ENVMAP_TYPE_CUBE_UV

				uniform samplerCube envMap;
				uniform float flipEnvMap;
				varying vec2 vUv;

				#include <common>
				#include <cube_uv_reflection_fragment>

				${Mr}

				void main() {

					vec3 rayDirection = equirectUvToDirection( vUv );
					rayDirection.x *= flipEnvMap;
					gl_FragColor = textureCube( envMap, rayDirection );

				}`}),this.depthWrite=!1,this.depthTest=!1}}class Ki{constructor(e){this._renderer=e,this._quad=new _e(new Hn)}generate(e,t=null,i=null){if(!e.isCubeTexture)throw new Error("CubeToEquirectMaterial: Source can only be cube textures.");const a=e.images[0],n=this._renderer,r=this._quad;t===null&&(t=4*a.height),i===null&&(i=2*a.height);const c=new et(t,i,{type:V,colorSpace:a.colorSpace}),l=a.height,h=Math.log2(l)-2,f=1/l,u=1/(3*Math.max(Math.pow(2,h),112));r.material.defines.CUBEUV_MAX_MIP=`${h}.0`,r.material.defines.CUBEUV_TEXEL_WIDTH=u,r.material.defines.CUBEUV_TEXEL_HEIGHT=f,r.material.uniforms.envMap.value=e,r.material.uniforms.flipEnvMap.value=e.isRenderTargetTexture?1:-1,r.material.needsUpdate=!0;const o=n.getRenderTarget(),m=n.autoClear;n.autoClear=!0,n.setRenderTarget(c),r.render(n),n.setRenderTarget(o),n.autoClear=m;const g=new Uint16Array(t*i*4),x=new Float32Array(t*i*4);n.readRenderTargetPixels(c,0,0,t,i,x),c.dispose();for(let p=0,v=x.length;p<v;p++)g[p]=ce.toHalfFloat(x[p]);const d=new ee(g,t,i,U,ae);return d.minFilter=Wr,d.magFilter=re,d.wrapS=pe,d.wrapT=pe,d.mapping=cr,d.needsUpdate=!0,d}dispose(){this._quad.dispose()}}function Ln(s){return s.extensions.get("EXT_float_blend")}const Oe=new Y;class Un{get multipleImportanceSampling(){return!!this._pathTracer.material.defines.FEATURE_MIS}set multipleImportanceSampling(e){this._pathTracer.material.setDefine("FEATURE_MIS",e?1:0)}get transmissiveBounces(){return this._pathTracer.material.transmissiveBounces}set transmissiveBounces(e){this._pathTracer.material.transmissiveBounces=e}get bounces(){return this._pathTracer.material.bounces}set bounces(e){this._pathTracer.material.bounces=e}get filterGlossyFactor(){return this._pathTracer.material.filterGlossyFactor}set filterGlossyFactor(e){this._pathTracer.material.filterGlossyFactor=e}get samples(){return this._pathTracer.samples}get target(){return this._pathTracer.target}get tiles(){return this._pathTracer.tiles}get stableNoise(){return this._pathTracer.stableNoise}set stableNoise(e){this._pathTracer.stableNoise=e}get isCompiling(){return!!this._pathTracer.isCompiling}constructor(e){this._renderer=e,this._generator=new Sa,this._pathTracer=new Yi(e),this._queueReset=!1,this._clock=new Vr,this._compilePromise=null,this._lowResPathTracer=new Yi(e),this._lowResPathTracer.tiles.set(1,1),this._quad=new _e(new Nn({map:null,transparent:!0,blending:it,premultipliedAlpha:e.getContextAttributes().premultipliedAlpha})),this._materials=null,this._previousEnvironment=null,this._previousBackground=null,this._internalBackground=null,this.renderDelay=100,this.minSamples=5,this.fadeDuration=500,this.enablePathTracing=!0,this.pausePathTracing=!1,this.dynamicLowRes=!1,this.lowResScale=.25,this.renderScale=1,this.synchronizeRenderSize=!0,this.rasterizeScene=!0,this.renderToCanvas=!0,this.textureSize=new Y(1024,1024),this.rasterizeSceneCallback=(t,i)=>{this._renderer.render(t,i)},this.renderToCanvasCallback=(t,i,a)=>{const n=i.autoClear;i.autoClear=!1,a.render(i),i.autoClear=n},this.setScene(new qr,new or)}setBVHWorker(e){this._generator.setBVHWorker(e)}setScene(e,t,i={}){e.updateMatrixWorld(!0),t.updateMatrixWorld();const a=this._generator;if(a.setObjects(e),this._buildAsync)return a.generateAsync(i.onProgress).then(n=>this._updateFromResults(e,t,n));{const n=a.generate();return this._updateFromResults(e,t,n)}}setSceneAsync(...e){this._buildAsync=!0;const t=this.setScene(...e);return this._buildAsync=!1,t}setCamera(e){this.camera=e,this.updateCamera()}updateCamera(){const e=this.camera;e.updateMatrixWorld(),this._pathTracer.setCamera(e),this._lowResPathTracer.setCamera(e),this.reset()}updateMaterials(){const e=this._pathTracer.material,t=this._renderer,i=this._materials,a=this.textureSize,n=qa(i);e.textures.setTextures(t,n,a.x,a.y),e.materials.updateFrom(i,n),this.reset()}updateLights(){const e=this.scene,t=this._renderer,i=this._pathTracer.material,a=Ga(e),n=Va(a);i.lights.updateFrom(a,n),i.iesProfiles.setTextures(t,n),this.reset()}updateEnvironment(){const e=this.scene,t=this._pathTracer.material;if(this._internalBackground&&(this._internalBackground.dispose(),this._internalBackground=null),t.backgroundBlur=e.backgroundBlurriness,t.backgroundIntensity=e.backgroundIntensity??1,t.backgroundRotation.makeRotationFromEuler(e.backgroundRotation).invert(),e.background===null)t.backgroundMap=null,t.backgroundAlpha=0;else if(e.background.isColor){this._colorBackground=this._colorBackground||new On(16);const i=this._colorBackground;i.topColor.equals(e.background)||(i.topColor.set(e.background),i.bottomColor.set(e.background),i.update()),t.backgroundMap=i,t.backgroundAlpha=1}else if(e.background.isCubeTexture){if(e.background!==this._previousBackground){const i=new Ki(this._renderer).generate(e.background);this._internalBackground=i,t.backgroundMap=i,t.backgroundAlpha=1}}else t.backgroundMap=e.background,t.backgroundAlpha=1;if(t.environmentIntensity=e.environmentIntensity??1,t.environmentRotation.makeRotationFromEuler(e.environmentRotation).invert(),this._previousEnvironment!==e.environment)if(e.environment!==null)if(e.environment.isCubeTexture){const i=new Ki(this._renderer).generate(e.environment);t.envMapInfo.updateFrom(i)}else t.envMapInfo.updateFrom(e.environment);else t.environmentIntensity=0;this._previousEnvironment=e.environment,this._previousBackground=e.background,this.reset()}_updateFromResults(e,t,i){const{materials:a,geometry:n,bvh:r,bvhChanged:c}=i;this._materials=a;const h=this._pathTracer.material;return c&&(h.bvh.updateFrom(r),h.attributesArray.updateFrom(n.attributes.normal,n.attributes.tangent,n.attributes.uv,n.attributes.color),h.materialIndexAttribute.updateFrom(n.attributes.materialIndex)),this._previousScene=e,this.scene=e,this.camera=t,this.updateCamera(),this.updateMaterials(),this.updateEnvironment(),this.updateLights(),i}renderSample(){const e=this._lowResPathTracer,t=this._pathTracer,i=this._renderer,a=this._clock,n=this._quad;this._updateScale(),this._queueReset&&(t.reset(),e.reset(),this._queueReset=!1,n.material.opacity=0,a.start());const r=a.getDelta()*1e3,c=a.getElapsedTime()*1e3;if(!this.pausePathTracing&&this.enablePathTracing&&this.renderDelay<=c&&!this.isCompiling&&t.update(),t.alpha=t.material.backgroundAlpha!==1||!Ln(i),e.alpha=t.alpha,this.renderToCanvas){const l=this._renderer,h=this.minSamples;if(c>=this.renderDelay&&this.samples>=this.minSamples&&(this.fadeDuration!==0?n.material.opacity=Math.min(n.material.opacity+r/this.fadeDuration,1):n.material.opacity=1),!this.enablePathTracing||this.samples<h||n.material.opacity<1){if(this.dynamicLowRes&&!this.isCompiling){e.samples<1&&(e.material=t.material,e.update());const f=n.material.opacity;n.material.opacity=1-n.material.opacity,n.material.map=e.target.texture,n.render(l),n.material.opacity=f}(!this.dynamicLowRes&&this.rasterizeScene||this.dynamicLowRes&&this.isCompiling)&&this.rasterizeSceneCallback(this.scene,this.camera)}this.enablePathTracing&&n.material.opacity>0&&(n.material.opacity<1&&(n.material.blending=this.dynamicLowRes?Gr:ci),n.material.map=t.target.texture,this.renderToCanvasCallback(t.target,l,n),n.material.blending=it)}}reset(){this._queueReset=!0,this._pathTracer.samples=0}dispose(){this._renderQuad.dispose(),this._renderQuad.material.dispose(),this._pathTracer.dispose()}_updateScale(){if(this.synchronizeRenderSize){this._renderer.getDrawingBufferSize(Oe);const e=Math.floor(this.renderScale*Oe.x),t=Math.floor(this.renderScale*Oe.y);if(this._pathTracer.getSize(Oe),Oe.x!==e||Oe.y!==t){const i=this.lowResScale;this._pathTracer.setSize(e,t),this._lowResPathTracer.setSize(Math.floor(e*i),Math.floor(t*i))}}}}const Wn=15e5,Vn=8e3,qn=350,Gn=2,$n=.8,jn=1.5,Yn=2,Xn=.025,Qn=.55,Kn=2,Zn=120,Jn=.04;function eo(s){if(s.userData.bbNoStudio===!0)return!0;const e=s;if(!e.isMesh)return!1;if(s.isInstancedMesh)return!0;const t=e.material;return(Array.isArray(t)?t:[t]).some(a=>!!a&&(a.isShaderMaterial===!0||a.isShadowMaterial===!0))}function to(s){const e=s.getIndex();if(e)return e.count/3;const t=s.getAttribute("position");return t?t.count/3:0}function Xe(s){return s?s.isInterleavedBufferAttribute===!0?s.clone():s:null}function Zi(s,e){const t=s.array,i=t.constructor,a=new i(t.length*e);for(let n=0;n<e;n++)a.set(t,n*t.length);return new H(a,s.itemSize,s.normalized)}function Ir(s){const e=s.geometry,t=Xe(e.getAttribute("position"));if(!t||t.itemSize!==3||!(t.array instanceof Float32Array))return null;const i=Xe(e.getAttribute("normal")),a=Xe(e.getAttribute("tangent"));if(i&&!(i.array instanceof Float32Array)||a&&!(a.array instanceof Float32Array))return null;const n=s.count,r=t.count,c=new ve,l=e.getIndex();if(l){const T=l.array,b=r*n>65535?new Uint32Array(l.count*n):new Uint16Array(l.count*n);for(let S=0;S<n;S++){const w=S*r,A=S*l.count;for(let _=0;_<l.count;_++)b[A+_]=T[_]+w}c.setIndex(new H(b,1))}const h=t.array,f=new Float32Array(r*n*3),u=i?i.array:null,o=u?new Float32Array(r*n*3):null,m=a?a.array:null,g=m&&a?new Float32Array(r*n*a.itemSize):null,x=new L,d=new ar,p=r*3;for(let T=0;T<n;T++){s.getMatrixAt(T,x),x.premultiply(s.matrixWorld);const b=x.elements;let S=T*p;for(let w=0;w<p;w+=3){const A=h[w],_=h[w+1],I=h[w+2];f[S++]=b[0]*A+b[4]*_+b[8]*I+b[12],f[S++]=b[1]*A+b[5]*_+b[9]*I+b[13],f[S++]=b[2]*A+b[6]*_+b[10]*I+b[14]}if(u&&o){const w=d.getNormalMatrix(x).elements;let A=T*p;for(let _=0;_<p;_+=3){const I=u[_],R=u[_+1],M=u[_+2],P=w[0]*I+w[3]*R+w[6]*M,C=w[1]*I+w[4]*R+w[7]*M,D=w[2]*I+w[5]*R+w[8]*M,E=Math.sqrt(P*P+C*C+D*D),W=E>0?1/E:0;o[A++]=P*W,o[A++]=C*W,o[A++]=D*W}}if(m&&g&&a){const w=a.itemSize,A=r*w;let _=T*A;for(let I=0;I<A;I+=w){const R=m[I],M=m[I+1],P=m[I+2],C=b[0]*R+b[4]*M+b[8]*P,D=b[1]*R+b[5]*M+b[9]*P,E=b[2]*R+b[6]*M+b[10]*P,W=Math.sqrt(C*C+D*D+E*E),X=W>0?1/W:0;g[_++]=C*X,g[_++]=D*X,g[_++]=E*X,w===4&&(g[_++]=m[I+3])}}}c.setAttribute("position",new H(f,3)),o&&c.setAttribute("normal",new H(o,3)),g&&a&&c.setAttribute("tangent",new H(g,a.itemSize));const v=Xe(e.getAttribute("uv"));v&&c.setAttribute("uv",Zi(v,n));const y=Xe(e.getAttribute("color"));return y&&c.setAttribute("color",Zi(y,n)),c}function io(){return new rt({name:"StudioGrain",uniforms:{seed:{value:1},amount:{value:Jn}},vertexShader:`
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `,fragmentShader:`
      uniform float seed;
      uniform float amount;
      float hash( vec2 p ) {
        return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453123 );
      }
      void main() {
        float n = hash( gl_FragCoord.xy + vec2( seed * 17.13, seed * 9.77 ) );
        float s = n * 2.0 - 1.0; // signed grain
        // normal blending toward white/black: ± luminance, zero-mean overall
        gl_FragColor = vec4( vec3( step( 0.0, s ) ), abs( s ) * amount );
      }
    `,transparent:!0,blending:ci,depthTest:!1,depthWrite:!1})}function Ji(s,e){var i,a,n,r,c,l,h,f,u;const t=s;for(const o of[t._pathTracer,t._lowResPathTracer]){if(!o)continue;try{(i=o.dispose)==null||i.call(o)}catch{}const m=o.material;if(m!=null&&m.uniforms){for(const g of Object.keys(m.uniforms)){const x=m.uniforms[g].value;if(!(!x||e.has(x)))try{typeof x.dispose=="function"?x.dispose():x.tex&&typeof x.tex.dispose=="function"&&x.tex.dispose()}catch{}}try{m.dispose()}catch{}}}try{(n=(a=t._quad)==null?void 0:a.material)==null||n.dispose(),(c=(r=t._quad)==null?void 0:r.dispose)==null||c.call(r),(h=(l=t._colorBackground)==null?void 0:l.dispose)==null||h.call(l),(u=(f=t._internalBackground)==null?void 0:f.dispose)==null||u.call(f)}catch{}}async function ro(){try{const s=await Kr(()=>import("./GenerateMeshBVHWorker-D-myiTYL.js"),__vite__mapDeps([0,1,2,3])),e=new s.GenerateMeshBVHWorker,t=new ve;t.setAttribute("position",new H(new Float32Array([0,0,0,1,0,0,0,1,0]),3));const i=new Promise((a,n)=>{setTimeout(()=>n(new Error("BVH worker probe timed out")),Vn)});return await Promise.race([e.generate(t),i]),t.dispose(),e}catch(s){return console.warn("[render-modes] BVH worker unavailable — falling back to sync builds",s),null}}async function so(s,e,t){const i=await ro();return new Rr(s,e,i,t)}class Rr{constructor(e,t,i,a){B(this,"ctx");B(this,"enhanced");B(this,"onProgress");B(this,"worker");B(this,"pathTracer");B(this,"sceneDirty",!0);B(this,"building",!1);B(this,"hasScene",!1);B(this,"disposed",!1);B(this,"buildFailures",0);B(this,"targetSamples");B(this,"lastCamWorld",new L);B(this,"lastCamProj",new L);B(this,"lastEnv",null);B(this,"camPrimed",!1);B(this,"studioCamera",new _r);B(this,"camPos",new F);B(this,"camDir",new F);B(this,"drawSize",new Y);B(this,"shadowRelaxed",!1);B(this,"grainMaterial");B(this,"grainQuad");B(this,"savedCoat",new Map);B(this,"savedMatte",new Map);B(this,"matteStandIns",[]);B(this,"progress",{phase:"building",samples:0,targetSamples:0,converged:!1});B(this,"lastEmittedSamples",-1);B(this,"lastEmittedPhase",null);this.ctx=e,this.enhanced=t,this.worker=i,this.onProgress=a,this.targetSamples=$r(e.caps),this.progress.targetSamples=this.targetSamples,this.studioCamera.matrixAutoUpdate=!1,this.grainMaterial=io(),this.grainQuad=new _e(this.grainMaterial),this.pathTracer=this.makePathTracer()}makePathTracer(){const{renderer:e,caps:t}=this.ctx,i=new Un(e);return i.bounces=6,i.transmissiveBounces=8,i.filterGlossyFactor=.25,i.renderScale=xi(t),i.synchronizeRenderSize=!0,i.tiles.set(Ft(t),Ft(t)),i.dynamicLowRes=!1,i.renderDelay=0,i.minSamples=3,i.fadeDuration=qn,i.renderToCanvas=!0,i.rasterizeScene=!0,i.rasterizeSceneCallback=()=>{this.enhanced.render()},i.renderToCanvasCallback=(a,n,r)=>{const c=n.autoClear;n.autoClear=!1,r.render(n),this.grainMaterial.uniforms.seed.value=Math.floor(this.pathTracer.samples)%256+1,this.grainQuad.render(n),n.autoClear=c},this.worker&&i.setBVHWorker(this.worker),i}invalidate(){this.sceneDirty=!0}refreshMaterials(){this.hasScene&&!this.building?this.pathTracer.updateMaterials():this.sceneDirty=!0}get converged(){return this.hasScene&&!this.building&&this.pathTracer.samples>=this.targetSamples}emit(e,t){const i=Math.floor(t);e===this.lastEmittedPhase&&i===this.lastEmittedSamples||(this.lastEmittedPhase=e,this.lastEmittedSamples=i,this.progress.phase=e,this.progress.samples=i,this.progress.converged=e==="converged",this.onProgress(this.progress))}syncStudioCamera(){const e=this.ctx.camera,t=this.studioCamera;t.fov=e.fov,t.aspect=e.aspect,t.near=e.near,t.far=e.far,t.matrix.copy(e.matrixWorld),t.matrixWorld.copy(e.matrixWorld),t.projectionMatrix.copy(e.projectionMatrix),t.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.camPos.setFromMatrixPosition(e.matrixWorld),this.camDir.set(0,0,-1).transformDirection(e.matrixWorld);let i=this.camPos.length();if(Math.abs(this.camDir.y)>1e-4){const a=(Qn-this.camPos.y)/this.camDir.y;a>0&&(i=a)}i=Dt.clamp(i,Kn,Zn),t.focusDistance=i,t.bokehSize=i*Xn*1e3}buildInstanceExpansion(){const e=new jr;e.name="studio-instance-expansion";let t=Wn;return this.ctx.scene.traverse(i=>{const a=i;if(!a.isInstancedMesh||a.count===0||a.userData.bbNoStudio===!0)return;for(let c=a;c;c=c.parent)if(!c.visible)return;const n=to(a.geometry)*a.count;if(n>t)return;const r=Ir(a);r&&(t-=n,e.add(new nr(r,a.material)))}),e.children.length>0?e:null}applyMaterialOverrides(){this.ctx.scene.traverse(e=>{const t=e;if(!t.isMesh)return;if(t.userData.bbStudioMatte===!0&&!this.savedMatte.has(t)){const a=t.material,n=Array.isArray(a)?a[0]:a,r=new Yr({map:n.map??null,color:n.color?n.color.clone():new Ue(16777215),transparent:n.transparent===!0,depthWrite:n.depthWrite!==!1,roughness:1,metalness:0});this.savedMatte.set(t,a),this.matteStandIns.push(r),t.material=r;return}const i=Array.isArray(t.material)?t.material:[t.material];for(const a of i){const n=a;if(n&&n.isMeshPhysicalMaterial===!0&&typeof n.clearcoat=="number"&&n.clearcoat!==0&&!this.savedCoat.has(n)){this.savedCoat.set(n,{clearcoat:n.clearcoat,roughness:n.roughness,specularIntensity:n.specularIntensity});const r=Dt.clamp(n.clearcoat,0,1),c=Math.min(n.roughness,n.clearcoatRoughness*$n),l=Math.min(1,r*jn);n.roughness=Dt.lerp(n.roughness,c,l),n.specularIntensity=Math.min(Yn,n.specularIntensity+r),n.clearcoat=0}}})}restoreMaterialOverrides(){for(const[e,t]of this.savedCoat)e.clearcoat=t.clearcoat,e.roughness=t.roughness,e.specularIntensity=t.specularIntensity;this.savedCoat.clear();for(const[e,t]of this.savedMatte)e.material=t;this.savedMatte.clear();for(const e of this.matteStandIns)e.dispose();this.matteStandIns.length=0}startRebuild(){this.sceneDirty=!1,this.building=!0,this.hasScene=!1,this.emit("building",0),this.applyMaterialOverrides(),this.syncStudioCamera();const{scene:e}=this.ctx,t=this.buildInstanceExpansion(),i=[];e.traverse(n=>{n.visible&&eo(n)&&(n.visible=!1,i.push(n))}),t&&e.add(t);let a;try{a=this.worker?this.pathTracer.setSceneAsync(e,this.studioCamera):Promise.resolve(this.pathTracer.setScene(e,this.studioCamera))}catch(n){a=Promise.reject(n)}finally{for(const n of i)n.visible=!0;if(t){e.remove(t);for(const n of t.children)n.geometry.dispose()}}a.then(()=>{this.disposed||(this.building=!1,this.hasScene=!0,this.buildFailures=0,this.lastEnv=e.environment,this.primeCamera(),this.pathTracer.reset(),this.emit("sampling",0))},n=>{console.warn("[render-modes] studio scene build failed",n),!this.disposed&&(this.building=!1,this.buildFailures++,!(this.buildFailures>Gn)&&(this.sceneDirty=!0,this.worker&&(this.worker.dispose(),this.worker=null,Ji(this.pathTracer,this.liveTextures()),this.pathTracer=this.makePathTracer())))})}primeCamera(){const e=this.ctx.camera;e.updateMatrixWorld(),this.lastCamWorld.copy(e.matrixWorld),this.lastCamProj.copy(e.projectionMatrix),this.camPrimed=!0,this.syncStudioCamera(),this.pathTracer.updateCamera()}updateBudgets(){const{renderer:e,caps:t}=this.ctx,i=this.pathTracer;e.getDrawingBufferSize(this.drawSize);const a=this.drawSize.x*this.drawSize.y,n=xi(t,a);i.renderScale!==n&&(i.renderScale=n);const r=a*n*n,c=Xr(Ft(t,r),i.samples);(i.tiles.x!==c||i.tiles.y!==c)&&i.tiles.set(c,c);const l=a>Qr;l!==this.shadowRelaxed&&(this.shadowRelaxed=l,this.enhanced.setShadowRelaxed(l))}render(){if(this.disposed||(this.updateBudgets(),this.sceneDirty&&!this.building&&this.startRebuild(),!this.hasScene||this.building))return!1;this.ctx.scene.environment!==this.lastEnv&&(this.lastEnv=this.ctx.scene.environment,this.pathTracer.updateEnvironment());const e=this.ctx.camera;return e.updateMatrixWorld(),!this.camPrimed||!this.lastCamWorld.equals(e.matrixWorld)||!this.lastCamProj.equals(e.projectionMatrix)?(this.lastCamWorld.copy(e.matrixWorld),this.lastCamProj.copy(e.projectionMatrix),this.camPrimed=!0,this.syncStudioCamera(),this.pathTracer.updateCamera(),!1):this.pathTracer.samples>=this.targetSamples?(this.emit("converged",this.pathTracer.samples),this.pathTracer.pausePathTracing=!0,this.pathTracer.renderSample(),this.pathTracer.pausePathTracing=!1,!0):(this.pathTracer.renderSample(),this.emit("sampling",this.pathTracer.samples),!0)}liveTextures(){return new Set([this.ctx.scene.environment,this.ctx.scene.background,this.enhanced.environmentTexture])}dispose(){var e;this.disposed||(this.disposed=!0,this.shadowRelaxed&&(this.shadowRelaxed=!1,this.enhanced.setShadowRelaxed(!1)),this.restoreMaterialOverrides(),(e=this.worker)==null||e.dispose(),this.worker=null,this.grainQuad.dispose(),this.grainMaterial.dispose(),Ji(this.pathTracer,this.liveTextures()))}}const co=Object.freeze(Object.defineProperty({__proto__:null,StudioPipeline:Rr,bakeInstancedMeshGeometry:Ir,createStudioPipeline:so},Symbol.toStringTag,{value:"Module"}));export{hi as M,co as s};
