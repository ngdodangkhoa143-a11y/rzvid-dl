(function () {
    const canvas = document.getElementById('three-canvas');
    if (!canvas) return;

    // 1. Initialize Scene, Camera, and Renderer
    const scene = new THREE.Scene();
    
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        alpha: true,         // Allows CSS grid background to show through
        antialias: true      // Prevents jagged particle edges
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // 2. Generate Random Particles
    const particleCount = 1200;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    const colorIndigo = new THREE.Color('#6366f1'); // brand-500
    const colorViolet = new THREE.Color('#a855f7'); // violet-500

    for (let i = 0; i < particleCount * 3; i += 3) {
        // Place particles in a wide 3D grid bounding volume
        positions[i] = (Math.random() - 0.5) * 14;     // X coordinate
        positions[i + 1] = (Math.random() - 0.5) * 14; // Y coordinate
        positions[i + 2] = (Math.random() - 0.5) * 10; // Z coordinate (depth)

        // Blend indigo and violet colors randomly
        const mixRatio = Math.random();
        const blended = colorIndigo.clone().lerp(colorViolet, mixRatio);
        colors[i] = blended.r;
        colors[i + 1] = blended.g;
        colors[i + 2] = blended.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // 3. Create a circular glowing texture dynamically via Canvas
    // This avoids having to load external image textures (no network bottlenecks)
    function createCircleTexture() {
        const matCanvas = document.createElement('canvas');
        matCanvas.width = 16;
        matCanvas.height = 16;
        const ctx = matCanvas.getContext('2d');
        
        const gradient = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.8)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 16, 16);
        return new THREE.CanvasTexture(matCanvas);
    }

    // 4. Create material with additive blending for glowing effect
    const material = new THREE.PointsMaterial({
        size: 0.09,
        vertexColors: true,
        transparent: true,
        opacity: 0.45,
        map: createCircleTexture(),
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true
    });

    // 5. Mesh and add to Scene
    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    // 6. Interactive Mouse Parallax variables
    let mouseX = 0;
    let mouseY = 0;
    let targetX = 0;
    let targetY = 0;

    window.addEventListener('mousemove', (e) => {
        // Normalize mouse coordinates from [-0.5, 0.5]
        mouseX = (e.clientX / window.innerWidth) - 0.5;
        mouseY = (e.clientY / window.innerHeight) - 0.5;
    });

    // 7. Responsive Window Resize Handler
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    });

    // 8. Render Loop Animation
    const clock = new THREE.Clock();

    function animate() {
        requestAnimationFrame(animate);

        const elapsedTime = clock.getElapsedTime();

        // Slowly rotate the particle cloud
        particles.rotation.y = elapsedTime * 0.015;
        particles.rotation.x = elapsedTime * 0.008;

        // Interpolate mouse coordinates slowly for a smooth, lag-free drift effect
        targetX += (mouseX - targetX) * 0.04;
        targetY += (mouseY - targetY) * 0.04;

        // Translate the camera/mesh slightly based on the mouse target
        particles.position.x = targetX * 1.8;
        particles.position.y = -targetY * 1.8;

        renderer.render(scene, camera);
    }

    animate();
})();
