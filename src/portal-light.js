import * as THREE from '../vendor/three/three.module.min.js';
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

// One screen quad borrows the selected lobby door's membrane texture.
export class PortalLight {
  constructor(settings) {
    this.settings = settings; this.visible = false;
    this.scene = new THREE.Scene(); this.camera = new THREE.Camera();
    this.startRect = new THREE.Vector4(); this.coverRect = new THREE.Vector4();
    this.point = new THREE.Vector3();
    this.material = new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false,
      uniforms: { membrane: { value: null }, rect: { value: new THREE.Vector4() }, resolution: { value: new THREE.Vector2() },
        alpha: { value: 0 }, drift: { value: 0 }, leftColor: { value: new THREE.Color() }, rightColor: { value: new THREE.Color() },
        texturePixels: { value: settings.texturePixels }, brightness: { value: settings.brightness },
        edgePixels: { value: settings.edgePixels }, glowPixels: { value: settings.glowPixels }, glowStrength: { value: settings.glowStrength } },
      vertexShader: 'varying vec2 screenUv; void main(){screenUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: `varying vec2 screenUv;
        uniform sampler2D membrane; uniform vec4 rect; uniform vec2 resolution;
        uniform float alpha, drift, texturePixels, brightness, edgePixels, glowPixels, glowStrength;
        uniform vec3 leftColor, rightColor;
        void main(){
          vec2 p=(screenUv-rect.xy)*resolution;
          vec2 halfSize=rect.zw*resolution*.5;
          float edge=max(abs(p.x)-halfSize.x,abs(p.y)-halfSize.y);
          float glow=exp(-abs(edge)/max(1.,glowPixels))*glowStrength;
          if(edge>glowPixels*5.)discard;
          vec2 tile=screenUv*resolution/vec2(texturePixels,texturePixels*2.);
          vec2 uv=vec2(1.-abs(mod(tile.x,2.)-1.),fract(tile.y+drift));
          vec3 mist=texture2D(membrane,uv).rgb*brightness;
          vec3 color=mix(leftColor,rightColor,clamp(p.x/(halfSize.x*2.)+.5,0.,1.));
          float frame=1.-smoothstep(edgePixels*.5,edgePixels*1.5,abs(edge));
          float inside=1.-step(0.,edge);
          gl_FragColor=vec4(mix(color*(frame+glow),mist+color*(frame+glow),inside),alpha*max(inside,frame+glow));
          #include <colorspace_fragment>
        }` });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false; this.scene.add(this.quad);
  }
  begin(target, texture, colors, camera, width, height) {
    this.resize(width, height); target.group.updateWorldMatrix(true, false); camera.updateMatrixWorld();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const x of [-target.width / 2, target.width / 2]) for (const y of [0, target.height]) {
      this.point.set(x, y, 0).applyMatrix4(target.group.matrixWorld).project(camera);
      minX = Math.min(minX, this.point.x); maxX = Math.max(maxX, this.point.x);
      minY = Math.min(minY, this.point.y); maxY = Math.max(maxY, this.point.y);
    }
    const w = Math.max(0.03, (maxX - minX) / 2), h = Math.max(0.05, (maxY - minY) / 2);
    this.startRect.set((minX + maxX) / 4 + 0.5, (minY + maxY) / 4 + 0.5, w, h);
    const grow = Math.max(1 / w, 1 / h) * this.settings.coverMargin;
    this.coverRect.set(0.5, 0.5, w * grow, h * grow);
    const u = this.material.uniforms; u.membrane.value = texture;
    u.leftColor.value.set(colors[0]); u.rightColor.value.set(colors[1]); u.drift.value = 0;
    this.visible = true; this.cover(0);
  }
  resize(width, height) { this.material.uniforms.resolution.value.set(width, height); }
  cover(progress) {
    const t = smooth(progress); const u = this.material.uniforms;
    // Perspective-like acceleration as the camera approaches the threshold.
    const grow = (Math.exp(t * 2.5) - 1) / (Math.exp(2.5) - 1);
    u.rect.value.copy(this.startRect).lerp(this.coverRect, grow);
    u.alpha.value = smooth(progress / 0.3);
  }
  reveal(progress) {
    const u = this.material.uniforms; const t = smooth(progress);
    u.rect.value.copy(this.coverRect).lerp(this.startRect, t);
    u.alpha.value = 1 - t;
  }
  update(delta) { if (this.visible) this.material.uniforms.drift.value += delta * 0.025; }
  hide() { this.visible = false; this.material.uniforms.alpha.value = 0; }
  render(renderer) {
    if (!this.visible) return;
    const clear = renderer.autoClear; renderer.autoClear = false;
    renderer.render(this.scene, this.camera); renderer.autoClear = clear;
  }
}
