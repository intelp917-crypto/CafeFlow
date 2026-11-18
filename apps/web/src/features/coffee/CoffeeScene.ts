import * as THREE from 'three';
import anime from 'animejs';

/**
 * The welcome animation: beans → grinder → powder → portafilter → extraction →
 * milk → rosetta latte art.
 *
 * anime.js animates a plain state object (never DOM), and the render loop maps
 * that state onto the Three.js meshes. This keeps the timeline deterministic
 * and makes `skip()` trivial.
 */

export interface CoffeeSceneOptions {
  onComplete: () => void;
  onStage?: (stage: CoffeeStage) => void;
}

export type CoffeeStage = 'beans' | 'grinding' | 'brewing' | 'milk' | 'art' | 'done';

export interface CoffeeSceneHandle {
  play: () => void;
  skip: () => void;
  dispose: () => void;
}

export function supportsWebGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function drawRosetta(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const cream = 'rgba(246, 232, 214, 0.96)';

  ctx.translate(size / 2, size / 2);
  ctx.strokeStyle = cream;
  ctx.lineCap = 'round';
  ctx.fillStyle = cream;

  // Stem
  ctx.lineWidth = size * 0.02;
  ctx.beginPath();
  ctx.moveTo(0, size * 0.2);
  ctx.quadraticCurveTo(size * 0.01, 0, 0, -size * 0.36);
  ctx.stroke();

  // Leaf petals: mirrored curved strokes that narrow towards the tip.
  const petals = 7;
  for (let i = 0; i < petals; i += 1) {
    const progress = i / (petals - 1);
    const y = -size * 0.3 + progress * size * 0.46;
    const width = size * (0.34 - progress * 0.2);
    const lift = size * (0.1 - progress * 0.04);
    ctx.lineWidth = size * (0.035 - progress * 0.02);

    for (const direction of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(
        direction * width * 0.25,
        y - lift,
        direction * width * 0.85,
        y - lift * 0.2,
        direction * width,
        y + size * 0.03,
      );
      ctx.stroke();
    }
  }

  // Soft highlight so the art reads as milk foam on crema.
  const highlight = ctx.createRadialGradient(0, 0, size * 0.05, 0, 0, size * 0.42);
  highlight.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
  highlight.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = highlight;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

export function createCoffeeScene(container: HTMLElement, options: CoffeeSceneOptions): CoffeeSceneHandle {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 3.4, 8.4);
  camera.lookAt(0, 1.7, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  /* ------------------------------- lighting ------------------------------- */
  scene.add(new THREE.AmbientLight(0xfff1e6, 1.15));

  const keyLight = new THREE.DirectionalLight(0xffd9b8, 2.1);
  keyLight.position.set(-3.5, 7, 4.5);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x96a09f, 0.85);
  rimLight.position.set(4, 3, -4);
  scene.add(rimLight);

  const warmPoint = new THREE.PointLight(0xffb27a, 6, 12, 2);
  warmPoint.position.set(0, 2.2, 2.4);
  scene.add(warmPoint);

  /* ------------------------------- materials ------------------------------ */
  const metal = track(new THREE.MeshStandardMaterial({ color: 0x3b3a3d, roughness: 0.34, metalness: 0.82 }));
  const darkMetal = track(new THREE.MeshStandardMaterial({ color: 0x24232a, roughness: 0.5, metalness: 0.7 }));
  const beanMaterial = track(new THREE.MeshStandardMaterial({ color: 0x5c3520, roughness: 0.55, metalness: 0.05 }));
  const ceramic = track(new THREE.MeshStandardMaterial({ color: 0xf7f2ea, roughness: 0.24, metalness: 0.02 }));
  const coffeeMaterial = track(new THREE.MeshStandardMaterial({ color: 0x3a2113, roughness: 0.42, metalness: 0.02 }));
  const espressoMaterial = track(
    new THREE.MeshStandardMaterial({ color: 0x2c170d, roughness: 0.3, transparent: true, opacity: 0.92 }),
  );
  const milkMaterial = track(
    new THREE.MeshStandardMaterial({ color: 0xfdf8f1, roughness: 0.2, transparent: true, opacity: 0.9 }),
  );

  /* --------------------------------- beans -------------------------------- */
  const beans = new THREE.Group();
  const beanGeometry = track(new THREE.SphereGeometry(0.16, 20, 14));
  const beanPositions: Array<[number, number, number]> = [
    [-0.42, 4.9, 0.1],
    [0.36, 5.1, -0.2],
    [0.05, 5.35, 0.22],
    [-0.2, 5.2, -0.28],
    [0.5, 4.85, 0.24],
  ];
  for (const [x, y, z] of beanPositions) {
    const bean = new THREE.Mesh(beanGeometry, beanMaterial);
    bean.position.set(x, y, z);
    bean.scale.set(1.35, 1, 0.85);
    beans.add(bean);
  }
  scene.add(beans);

  /* -------------------------------- grinder ------------------------------- */
  const grinder = new THREE.Group();
  grinder.position.set(0, 2.7, 0);

  const hopper = new THREE.Mesh(track(new THREE.ConeGeometry(0.78, 0.85, 32, 1, true)), metal);
  hopper.position.y = 0.72;
  hopper.rotation.x = Math.PI;
  grinder.add(hopper);

  const grinderBody = new THREE.Mesh(track(new THREE.CylinderGeometry(0.56, 0.6, 1.05, 32)), darkMetal);
  grinder.add(grinderBody);

  const grinderBase = new THREE.Mesh(track(new THREE.CylinderGeometry(0.7, 0.72, 0.12, 32)), metal);
  grinderBase.position.y = -0.58;
  grinder.add(grinderBase);

  const chute = new THREE.Mesh(track(new THREE.CylinderGeometry(0.16, 0.24, 0.42, 20)), metal);
  chute.position.set(0, -0.86, 0.06);
  grinder.add(chute);

  scene.add(grinder);

  /* ----------------------------- portafilter ------------------------------ */
  const portafilter = new THREE.Group();
  portafilter.position.set(0, 1.62, 0);

  const basket = new THREE.Mesh(track(new THREE.CylinderGeometry(0.5, 0.4, 0.24, 28)), metal);
  portafilter.add(basket);

  const handle = new THREE.Mesh(track(new THREE.BoxGeometry(0.9, 0.11, 0.13)), darkMetal);
  handle.position.set(0.85, 0.02, 0);
  portafilter.add(handle);

  scene.add(portafilter);

  /* ---------------------------------- cup --------------------------------- */
  const cup = new THREE.Group();
  cup.position.set(0, 0.42, 0);

  const cupBody = new THREE.Mesh(track(new THREE.CylinderGeometry(0.62, 0.5, 0.62, 36, 1, true)), ceramic);
  cup.add(cupBody);

  const cupBase = new THREE.Mesh(track(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 36)), ceramic);
  cupBase.position.y = -0.31;
  cup.add(cupBase);

  const saucer = new THREE.Mesh(track(new THREE.CylinderGeometry(1.05, 1.05, 0.05, 40)), ceramic);
  saucer.position.y = -0.42;
  cup.add(saucer);

  const coffeeSurface = new THREE.Mesh(track(new THREE.CircleGeometry(0.55, 40)), coffeeMaterial);
  coffeeSurface.rotation.x = -Math.PI / 2;
  coffeeSurface.position.y = 0.27;
  cup.add(coffeeSurface);

  const artTexture = track(new THREE.CanvasTexture(drawRosetta(512)));
  const artMaterial = track(
    new THREE.MeshBasicMaterial({ map: artTexture, transparent: true, opacity: 0, depthWrite: false }),
  );
  const latteArt = new THREE.Mesh(track(new THREE.CircleGeometry(0.54, 40)), artMaterial);
  latteArt.rotation.x = -Math.PI / 2;
  latteArt.position.y = 0.275;
  cup.add(latteArt);

  scene.add(cup);

  // Soft contact shadow under the cup keeps the scene grounded without a
  // shadow-map pass (cheaper on mobile).
  const shadow = new THREE.Mesh(
    track(new THREE.CircleGeometry(1.25, 36)),
    track(new THREE.MeshBasicMaterial({ color: 0x1a0f08, transparent: true, opacity: 0.22 })),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.02;
  scene.add(shadow);

  /* -------------------------------- streams ------------------------------- */
  const extractionStream = new THREE.Mesh(track(new THREE.CylinderGeometry(0.028, 0.028, 1, 10)), espressoMaterial);
  extractionStream.position.set(0, 1.32, 0);
  extractionStream.scale.y = 0.0001;
  scene.add(extractionStream);

  const milkStream = new THREE.Mesh(track(new THREE.CylinderGeometry(0.024, 0.03, 1, 10)), milkMaterial);
  milkStream.position.set(-0.2, 1.5, 0.34);
  milkStream.rotation.z = 0.22;
  milkStream.scale.y = 0.0001;
  scene.add(milkStream);

  /* --------------------------------- powder ------------------------------- */
  const powderCount = 150;
  const powderPositions = new Float32Array(powderCount * 3);
  const powderSeed: number[] = [];
  for (let i = 0; i < powderCount; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * 0.22;
    powderPositions[i * 3] = Math.cos(angle) * radius;
    powderPositions[i * 3 + 1] = 1.9 + Math.random() * 0.7;
    powderPositions[i * 3 + 2] = Math.sin(angle) * radius;
    powderSeed.push(0.6 + Math.random() * 0.8);
  }
  const powderGeometry = track(new THREE.BufferGeometry());
  powderGeometry.setAttribute('position', new THREE.BufferAttribute(powderPositions, 3));
  const powderMaterial = track(
    new THREE.PointsMaterial({ color: 0x4b2c19, size: 0.045, transparent: true, opacity: 0 }),
  );
  const powder = new THREE.Points(powderGeometry, powderMaterial);
  scene.add(powder);

  /* -------------------------------- timeline ------------------------------ */
  const state = {
    beanDrop: 0,
    grind: 0,
    powder: 0,
    extraction: 0,
    milk: 0,
    art: 0,
  };

  let rafId = 0;
  let startTime = performance.now();
  let finished = false;

  const complete = () => {
    if (finished) return;
    finished = true;
    options.onStage?.('done');
    options.onComplete();
  };

  const timeline = anime.timeline({
    easing: 'easeInOutQuad',
    complete,
  });

  const play = () => {
    startTime = performance.now();
    options.onStage?.('beans');
    timeline
      .add({ targets: state, beanDrop: 1, duration: 900, easing: 'easeInQuad', begin: () => options.onStage?.('beans') })
      .add({ targets: state, grind: 1, duration: 600, begin: () => options.onStage?.('grinding') }, 850)
      .add({ targets: state, powder: 1, duration: 650 }, 1400)
      .add({ targets: state, powder: 0, duration: 350 }, 2150)
      .add({ targets: state, extraction: 1, duration: 900, begin: () => options.onStage?.('brewing') }, 2200)
      .add({ targets: state, milk: 1, duration: 700, begin: () => options.onStage?.('milk') }, 3250)
      .add({ targets: state, milk: 0, duration: 250 }, 3950)
      .add({ targets: state, art: 1, duration: 850, begin: () => options.onStage?.('art') }, 3950);
  };

  const render = () => {
    rafId = requestAnimationFrame(render);
    const elapsed = (performance.now() - startTime) / 1000;

    beans.position.y = -state.beanDrop * 2.05;
    const beanScale = Math.max(0.001, 1 - state.grind);
    beans.scale.set(beanScale, beanScale, beanScale);
    beans.rotation.y = elapsed * 0.6;
    beans.children.forEach((child, index) => {
      child.rotation.z = Math.sin(elapsed * 2 + index) * 0.5;
    });

    grinder.rotation.z = Math.sin(elapsed * 26) * 0.012 * state.grind * (1 - state.extraction * 0.6);

    // Powder falls from the chute into the basket while `powder` is active.
    if (state.powder > 0.001) {
      const positions = powderGeometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < powderCount; i += 1) {
        const baseY = 1.98 + ((i % 7) * 0.09);
        const fall = (elapsed * powderSeed[i]!) % 1.4;
        positions.setY(i, baseY - fall);
      }
      positions.needsUpdate = true;
    }
    powderMaterial.opacity = state.powder * 0.85;

    const streamHeight = Math.max(0.0001, state.extraction * 0.62);
    extractionStream.scale.y = streamHeight;
    extractionStream.position.y = 1.5 - streamHeight / 2;
    coffeeSurface.scale.setScalar(0.35 + state.extraction * 0.65);
    coffeeSurface.position.y = 0.24 + state.extraction * 0.03;

    const milkHeight = Math.max(0.0001, state.milk * 0.75);
    milkStream.scale.y = milkHeight;
    milkStream.position.y = 2.05 - milkHeight / 2;
    milkStream.position.x = -0.55 + state.milk * 0.5;

    artMaterial.opacity = state.art;
    latteArt.scale.setScalar(0.55 + 0.45 * state.art);
    latteArt.rotation.z = -0.25 + state.art * 0.25;

    warmPoint.intensity = 5 + Math.sin(elapsed * 1.6) * 0.6;
    camera.position.y = 3.35 - Math.min(state.art, 1) * 0.35;
    camera.lookAt(0, 1.7 - Math.min(state.art, 1) * 0.25, 0);

    renderer.render(scene, camera);
  };

  const resize = () => {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Keep the cup and grinder in frame on narrow phones.
    camera.position.z = width < 480 ? 11.2 : 8.4;
    camera.updateProjectionMatrix();
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  const skip = () => {
    timeline.pause();
    state.beanDrop = 1;
    state.grind = 1;
    state.powder = 0;
    state.extraction = 1;
    state.milk = 0;
    state.art = 1;
    // One final frame so the finished latte art is visible behind the CTA.
    renderer.render(scene, camera);
    complete();
  };

  const dispose = () => {
    cancelAnimationFrame(rafId);
    resizeObserver.disconnect();
    try {
      timeline.pause();
      anime.remove(state);
    } catch {
      // Timeline may already be complete; disposal must never throw.
    }
    for (const item of disposables) item.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode === container) {
      container.removeChild(renderer.domElement);
    }
  };

  render();

  return { play, skip, dispose };
}
