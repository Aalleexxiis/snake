const CELL_SIZE = 30;
const GRID_WIDTH = 42;
const GRID_HEIGHT = 21;
const WIDTH = CELL_SIZE * GRID_WIDTH;
const HEIGHT = CELL_SIZE * GRID_HEIGHT;
const FPS = 10;
const TAP_MAX_DIST = 12;
const BG_COUNT = 99;

const phaserConfig = {
  type: Phaser.AUTO,
  width: WIDTH,
  height: HEIGHT,
  parent: 'game',
  backgroundColor: '#000000',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: { preload, create, update }
};

const game = new Phaser.Game(phaserConfig);

/* ---------- preload ---------- */
function preload() {
  console.log("preload start");
  this.loadedBackgrounds = [];
  this.load.on('filecomplete-image', (key) => {
    console.log('image loaded:', key);
    if (typeof key === 'string' && key.startsWith('bg')) this.loadedBackgrounds.push(key);
  }, this);
  this.load.on('loaderror', (file) => {
    try { console.warn('loaderror', file.key, file.src); } catch (e) { console.warn('loaderror', file); }
  }, this);
  this.load.on('complete', () => console.log('preload complete, backgrounds loaded:', this.loadedBackgrounds.length), this);

  const v = '?v=' + Date.now(); // force cache bust avec timestamp

  this.load.image('pomme', 'images/pomme.png' + v);
  this.load.image('head', 'images/head.png' + v);
  this.load.image('body', 'images/body.png' + v);
  this.load.image('tail', 'images/tail.png' + v);
  this.load.image('angle_droit', 'images/angle_droit.png' + v);
  this.load.image('angle_gauche', 'images/angle_gauche.png' + v);
  this.load.image('start_bg', 'images/start_bg.jpg' + v);
  this.load.image('end_bg', 'images/end_bg.jpg' + v);
  for (let i = 1; i <= BG_COUNT; i++) {
    this.load.image('bg' + i, `backgrounds/bg_${i}.jpg` + v);
  }
  this.load.audio('musique', 'son/musique.ogg' + v);
  this.load.audio('eat', 'son/eat.ogg' + v);
  this.load.audio('gameover', 'son/gameover2.ogg' + v);
}

/* ---------- create ---------- */
function create() {
  console.log("create start");
  // helper to create a tiny fallback texture and return an Image
  const makeFallbackImage = (key, w = WIDTH, h = HEIGHT, depth = 0) => {
    const fbKey = 'fb_' + key;
    if (!this.textures.exists(fbKey)) {
      const canvasTex = this.textures.createCanvas(fbKey, 1, 1);
      canvasTex.context.fillStyle = '#001122';
      canvasTex.context.fillRect(0, 0, 1, 1);
      canvasTex.refresh();
    }
    return this.add.image(0, 0, fbKey).setOrigin(0).setDisplaySize(w, h).setDepth(depth);
  };

  // background / layers (use first successfully loaded bg if any)
  const firstBgKey = (this.loadedBackgrounds && this.loadedBackgrounds.length > 0) ? this.loadedBackgrounds[0] : 'bg1';
  if (this.textures.exists(firstBgKey)) {
    this.bgImage = this.add.image(0, 0, firstBgKey).setOrigin(0).setDisplaySize(WIDTH, HEIGHT);
  } else {
    console.warn('background not found:', firstBgKey, '- using fallback');
    this.bgImage = makeFallbackImage('background', WIDTH, HEIGHT, 0);
  }

  // start/end backgrounds (fallback safe)
  this.startBg = this.textures.exists('start_bg')
    ? this.add.image(0, 0, 'start_bg').setOrigin(0).setDisplaySize(WIDTH, HEIGHT).setDepth(5)
    : makeFallbackImage('start_bg', WIDTH, HEIGHT, 5);
  this.endBg = this.textures.exists('end_bg')
    ? this.add.image(0, 0, 'end_bg').setOrigin(0).setDisplaySize(WIDTH, HEIGHT).setDepth(5).setVisible(false)
    : makeFallbackImage('end_bg', WIDTH, HEIGHT, 5).setVisible(false);

  this.overlay = this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x000000).setOrigin(0).setAlpha(0).setDepth(6);

  // audio (safe)
  try { this.bgMusic = this.sound.add('musique', { loop: true, volume: 0.3 }); }
  catch (e) { console.warn('bgMusic not available', e); this.bgMusic = { play: ()=>{}, stop: ()=>{} }; }
  try { this.eatSound = this.sound.add('eat'); } catch (e) { console.warn('eat sound missing'); this.eatSound = { play: ()=>{} }; }
  try { this.goSound = this.sound.add('gameover'); } catch (e) { console.warn('gameover sound missing'); this.goSound = { play: ()=>{} }; }

  // state & UI
  this.gameState = initGameState();
  this.renderedSnake = [];
  this.appleSprite = this.textures.exists('pomme')
    ? this.add.image(0, 0, 'pomme').setDisplaySize(CELL_SIZE, CELL_SIZE).setOrigin(0.5).setVisible(false)
    : makeFallbackImage('pomme', CELL_SIZE, CELL_SIZE, 2).setOrigin(0.5).setVisible(false);

  this.scoreText = this.add.text(10, 10, 'Score: 0', { fontFamily: 'Comic Sans MS', fontSize: '36px', color: '#800020' }).setDepth(10);
  this.startText = this.add.text(WIDTH / 2, HEIGHT / 2, "Appuie sur l'écran ou ESPACE pour commencer", { fontFamily: 'Comic Sans MS', fontSize: '28px', color: '#fff' }).setOrigin(0.5).setDepth(6);

  // movement timer (paused until start)
  this.moveEvent = this.time.addEvent({ delay: 1000 / FPS, loop: true, callback: () => moveSnake.call(this), paused: true });

  // input: pointer (tap/swipe) + keyboard
  this.input.on('pointerdown', p => { this.touchStart = { x: p.x, y: p.y }; });
  this.input.on('pointerup', p => handlePointerUp.call(this, p));
  this.input.keyboard.on('keydown', (e) => {
    if (!this.gameState.started) { if (e.code === 'Space') startGame.call(this); return; }
    if (this.gameState.gameOver) { if (e.code === 'KeyR') restartGame.call(this); return; }
    if (e.code === 'ArrowUp' && !(this.gameState.direction.x === 0 && this.gameState.direction.y === 1)) this.gameState.direction = { x: 0, y: -1 };
    else if (e.code === 'ArrowDown' && !(this.gameState.direction.x === 0 && this.gameState.direction.y === -1)) this.gameState.direction = { x: 0, y: 1 };
    else if (e.code === 'ArrowLeft' && !(this.gameState.direction.x === 1 && this.gameState.direction.y === 0)) this.gameState.direction = { x: -1, y: 0 };
    else if (e.code === 'ArrowRight' && !(this.gameState.direction.x === -1 && this.gameState.direction.y === 0)) this.gameState.direction = { x: 1, y: 0 };
  });

  showStartScreen.call(this);
}

function update() {
  // nothing per-frame required; movement is timer-driven
  // small debug tick:
  // console.log('tick'); // décommente si besoin
}

/* ---------- helpers & game logic (unchanged) ---------- */
function initGameState() {
  return {
    snake: [{ x: 15, y: 10 }],
    direction: { x: 1, y: 0 },
    apple: { x: Phaser.Math.Between(0, GRID_WIDTH - 1), y: Phaser.Math.Between(0, GRID_HEIGHT - 1) },
    gameOver: false,
    started: false,
    score: 0,
    currentBgIndex: 1
  };
}

function showStartScreen() {
  // remove any leftover end text when returning to start
  if (this.endText) { this.endText.destroy(); this.endText = null; }

  this.startBg.setVisible(true);
  this.startText.setVisible(true);
  this.appleSprite.setVisible(false);
  const bgKey = (this.loadedBackgrounds && this.loadedBackgrounds.length > 0) ? this.loadedBackgrounds[0] : null;
  if (bgKey && this.textures.exists(bgKey) && typeof this.bgImage.setTexture === 'function') this.bgImage.setTexture(bgKey);
}

function startGame() {
  if (this.gameState.started) return;
  this.gameState.started = true;
  this.startBg.setVisible(false);
  this.startText.setVisible(false);
  try { this.bgMusic.play(); } catch (e) { /* autoplay locked until user gesture */ }
  this.moveEvent.paused = false;
  this.appleSprite.setVisible(true);
  drawEverything.call(this);
}

function restartGame() {
  // remove any end text from previous game
  if (this.endText) { this.endText.destroy(); this.endText = null; }

  this.gameState = initGameState();
  this.endBg.setVisible(false);
  this.overlay.setAlpha(0);
  this.startBg.setVisible(false);
  this.startText.setVisible(false);
  this.gameState.started = true;
  try { this.bgMusic.play(); } catch(e){}
  this.moveEvent.paused = false;
  drawEverything.call(this);
}

function handlePointerUp(pointer) {
  const endX = pointer.x, endY = pointer.y;
  if (!this.touchStart) { this.touchStart = { x: endX, y: endY }; return; }
  const dx = endX - this.touchStart.x, dy = endY - this.touchStart.y;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (Math.max(adx, ady) < TAP_MAX_DIST) {
    if (!this.gameState.started) startGame.call(this);
    else if (this.gameState.gameOver) restartGame.call(this);
    this.touchStart = null;
    return;
  }
  if (adx > ady) {
    if (dx > 0 && !(this.gameState.direction.x === -1 && this.gameState.direction.y === 0)) this.gameState.direction = { x: 1, y: 0 };
    else if (dx < 0 && !(this.gameState.direction.x === 1 && this.gameState.direction.y === 0)) this.gameState.direction = { x: -1, y: 0 };
  } else {
    if (dy > 0 && !(this.gameState.direction.x === 0 && this.gameState.direction.y === -1)) this.gameState.direction = { x: 0, y: 1 };
    else if (dy < 0 && !(this.gameState.direction.x === 0 && this.gameState.direction.y === 1)) this.gameState.direction = { x: 0, y: -1 };
  }
  this.touchStart = null;
}

function moveSnake() {
  if (!this.gameState.started || this.gameState.gameOver) return;
  const head = this.gameState.snake[0];
  const newHead = { x: head.x + this.gameState.direction.x, y: head.y + this.gameState.direction.y };
  if (this.gameState.snake.some(s => s.x === newHead.x && s.y === newHead.y) ||
      newHead.x < 0 || newHead.x >= GRID_WIDTH || newHead.y < 0 || newHead.y >= GRID_HEIGHT) {
    onDeath.call(this);
    return;
  }
  this.gameState.snake.unshift(newHead);
  if (newHead.x === this.gameState.apple.x && newHead.y === this.gameState.apple.y) {
    this.gameState.score++;
    try { this.eatSound.play(); } catch(e){}
    do {
      this.gameState.apple = { x: Phaser.Math.Between(0, GRID_WIDTH - 1), y: Phaser.Math.Between(0, GRID_HEIGHT - 1) };
    } while (this.gameState.snake.some(s => s.x === this.gameState.apple.x && s.y === this.gameState.apple.y));
    this.gameState.currentBgIndex = (this.gameState.currentBgIndex % BG_COUNT) + 1;
  } else {
    this.gameState.snake.pop();
  }
  drawEverything.call(this);
}

function drawEverything() {
  const bgKey = 'bg' + this.gameState.currentBgIndex;
  if (this.textures.exists(bgKey) && typeof this.bgImage.setTexture === 'function') this.bgImage.setTexture(bgKey);

  this.appleSprite
    .setPosition(this.gameState.apple.x * CELL_SIZE + CELL_SIZE / 2, this.gameState.apple.y * CELL_SIZE + CELL_SIZE / 2)
    .setDisplaySize(CELL_SIZE, CELL_SIZE);

  this.scoreText.setText('Score: ' + this.gameState.score);

  this.renderedSnake.forEach(s => s.destroy());
  this.renderedSnake = [];

  const snake = this.gameState.snake;

  const makeSeg = (x, y, key, angle = 0) => {
    console.log('makeSeg called with key:', key, 'angle:', angle, 'texture exists?', this.textures.exists(key));
    if (!this.textures.exists(key)) {
      console.warn('texture missing:', key, '- using fallback rectangle');
      return this.add.rectangle(x, y, CELL_SIZE, CELL_SIZE, 0x88aa88).setOrigin(0.5).setDepth(2);
    }
    const img = this.add.image(x, y, key).setOrigin(0.5).setAngle(angle).setDisplaySize(CELL_SIZE, CELL_SIZE).setDepth(2);
    if (!isFinite(img.scaleX) || !isFinite(img.scaleY) || img.displayWidth > CELL_SIZE * 8) {
      img.setScale(1);
      img.setDisplaySize(CELL_SIZE, CELL_SIZE);
    }
    return img;
  };

  if (snake.length === 1) {
    const head = snake[0];
    this.renderedSnake.push(makeSeg(head.x * CELL_SIZE + CELL_SIZE / 2, head.y * CELL_SIZE + CELL_SIZE / 2, 'head', angleFromDir(this.gameState.direction)));
  } else {
    const head = snake[0];
    this.renderedSnake.push(makeSeg(head.x * CELL_SIZE + CELL_SIZE / 2, head.y * CELL_SIZE + CELL_SIZE / 2, 'head', angleFromDir(this.gameState.direction)));

    for (let i = 1; i < snake.length - 1; i++) {
      const prev = snake[i - 1], cur = snake[i], next = snake[i + 1];
      const info = getBodySegmentInfo(prev, cur, next);
      this.renderedSnake.push(makeSeg(cur.x * CELL_SIZE + CELL_SIZE / 2, cur.y * CELL_SIZE + CELL_SIZE / 2, info.type, info.angle || 0));
    }

    const tail = snake[snake.length - 1];
    const beforeTail = snake[snake.length - 2];
    const tailDir = { x: tail.x - beforeTail.x, y: tail.y - beforeTail.y };
    const tailAngle = (angleFromDir(tailDir) + 180) % 360;
    this.renderedSnake.push(makeSeg(tail.x * CELL_SIZE + CELL_SIZE / 2, tail.y * CELL_SIZE + CELL_SIZE / 2, 'tail', tailAngle));
  }
}

// helper: convert a grid direction to degrees (0° = up)
// grid convention: x = colonne (horizontal), y = ligne (vertical)
// up = (0,-1), right = (1,0), down = (0,1), left = (-1,0)
function angleFromDir(dir) {
  if (!dir) return 0;
  if (dir.x === 0 && dir.y === -1) return 0;   // up
  if (dir.x === 1 && dir.y === 0) return 90;   // right
  if (dir.x === 0 && dir.y === 1) return 180;  // down
  if (dir.x === -1 && dir.y === 0) return 270; // left
  // fallback
  const deg = Math.atan2(dir.y, dir.x) * 180 / Math.PI;
  return ((deg + 90) % 360 + 360) % 360;
}

function getBodySegmentInfo(prev, current, next) {
  const inDir = normalize(current.x - prev.x, current.y - prev.y);
  const outDir = normalize(next.x - current.x, next.y - current.y);

  // straight segment
  if (inDir.x === outDir.x && inDir.y === outDir.y) {
    return { type: 'body', angle: angleFromDir(inDir) + 180 };
  }

  const key = `${inDir.x},${inDir.y}|${outDir.x},${outDir.y}`;

  // angle_droit base sprite = up -> right (0°)
  const right = {
    '-1,0|0,1': 0,   // up -> right
    '0,1|1,0': -90,   // right -> down
    '1,0|0,-1': -180, // down -> left
    '0,-1|-1,0': -270 // left -> up
  };
  // angle_gauche base sprite = up -> left (0°)
  const left = {
    '-1,0|0,-1': 180,   // up -> left
    '0,-1|1,0': 270,   // left -> down
    '1,0|0,1': 0,   // down -> right
    '0,1|-1,0': 90   // right -> up
  };

  
  console.log('=== segment ===');
  console.log('prev:', prev, 'cur:', current, 'next:', next);
  console.log('inDir:', inDir, 'outDir:', outDir);
  console.log('key:', key);
  console.log('right[key]:', right[key], 'left[key]:', left[key]);

  if (right[key] !== undefined) {
    console.log('-> angle_droit');
    return { type: 'angle_droit', angle: right[key] };
  }
  if (left[key] !== undefined) {
    console.log('-> angle_gauche');
    return { type: 'angle_gauche', angle: left[key] };
  }

  console.log('-> body fallback');
  return { type: 'body', angle: angleFromDir(inDir) };


}

function normalize(dx, dy) { return { x: dx === 0 ? 0 : dx / Math.abs(dx), y: dy === 0 ? 0 : dy / Math.abs(dy) }; }

function onDeath() {
  this.moveEvent.paused = true;
  try { this.bgMusic.stop(); } catch (e) {}
  try { this.goSound.play(); } catch(e){}

  // blink effect
  this.time.addEvent({
    delay: 100, repeat: 19, callback: () => {
      this.renderedSnake.forEach(s => s.visible = !s.visible);
    }, callbackScope: this
  });

  this.time.delayedCall(2000, () => {
    this.endBg.setVisible(true);

    // fade overlay to semi-transparent (not fully black)
    this.tweens.add({
      targets: this.overlay, alpha: 0.6, duration: 700, onComplete: () => {
        // avoid stacking end texts
        if (this.endText) { this.endText.destroy(); this.endText = null; }
        this.endText = this.add.text(WIDTH / 2, HEIGHT / 2 - 60, `Nul à chier le mec! Score: ${this.gameState.score}`, {
          fontFamily: 'Comic Sans MS', fontSize: '48px', color: '#800020'
        }).setOrigin(0.5).setDepth(20);
        this.gameState.gameOver = true;
      }
    });
  });
}

