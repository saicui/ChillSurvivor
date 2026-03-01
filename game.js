// ====== セットアップと状態管理 ======
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let cw = canvas.width = window.innerWidth;
let ch = canvas.height = window.innerHeight;

window.addEventListener('resize', () => {
    cw = canvas.width = window.innerWidth;
    ch = canvas.height = window.innerHeight;
});

const keys = {
    w: false, a: false, s: false, d: false,
    ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false
};

window.addEventListener('keydown', (e) => {
    if (keys.hasOwnProperty(e.key)) keys[e.key] = true;
});

window.addEventListener('keyup', (e) => {
    if (keys.hasOwnProperty(e.key)) keys[e.key] = false;
});

// ゲーム状態
const STATE = {
    TITLE: 0,
    PLAYING: 1,
    LEVEL_UP: 2,
    SHOP: 3,
    GAME_OVER: 4
};

let gameState = STATE.TITLE;

// マップ範囲
const mapWidth = 2000;
const mapHeight = 2000;

// カメラ
let camera = { x: mapWidth / 2, y: mapHeight / 2 };

// ====== DOM UI要素 ======
const titleScreen = document.getElementById('title-screen');
const diffButtons = document.querySelectorAll('.diff-btn');
const warningScreen = document.getElementById('warning-screen');
const uiExpBar = document.getElementById('exp-bar');
const uiExpText = document.getElementById('exp-text');
const uiHpBar = document.getElementById('hp-bar');
const uiStageText = document.getElementById('stage-text');
const uiCoinText = document.getElementById('coin-count');

const levelUpModal = document.getElementById('level-up-modal');
const upgradeOptionsDiv = document.getElementById('upgrade-options');

const shopModal = document.getElementById('shop-modal');
const shopOptionsDiv = document.getElementById('shop-options');
const shopCoinText = document.getElementById('shop-coin-count');
const nextStageBtn = document.getElementById('next-stage-button');

const gameOverModal = document.getElementById('game-over-modal');
const finalStageText = document.getElementById('final-stage');
const finalKillsText = document.getElementById('final-kills');
const retryButton = document.getElementById('retry-button');

// ====== ゲームデータ ======
let lastFrameTime = performance.now();
let killCount = 0;
let coins = 0;

// 難易度（1: Easy, 2: Normal, 3: Hard）
let currentDifficulty = 2;
// 難易度に応じた経験値倍率などのルックアップ
const diffConfig = {
    1: { expMultiplier: 0.7, enemyHpMult: 0.8 },
    2: { expMultiplier: 1.0, enemyHpMult: 1.0 },
    3: { expMultiplier: 1.5, enemyHpMult: 1.5 }
};

// ステージ進行データ
let currentStage = 1;
let enemiesGenerated = 0;
let enemiesKilledInStage = 0;
let stageConfig = {
    totalEnemies: 30,
    maxOnScreen: 10,
    spawnInterval: 1500,
    enemySpeedMultiplier: 1,
    enemyHp: 1
};

// ボス管理
let bossSpawnedInStage = false;
let isBossWarningActive = false;
let bossWarningStartTime = 0;

// エンティティ
let enemies = [];
let projectiles = [];
let enemyProjectiles = []; // 新要素②: 敵の遠距離弾
let drops = [];
let barrels = []; // 新要素③: 爆発タル
let explosions = []; // 爆発エフェクト管理
let playerWeapons = [];

// グローバルフラッシュ演出フラグ
let flashScreenTimer = 0;
// 磁石持続フラグ
let isMagnetActive = false;
let magnetTimer = 0;

// ======= 武器情報の定義 =======

// 1. 魔法の杖（初期武器・最も近い敵に撃つ）
const magicWandData = {
    id: 'magicWand',
    name: '魔法の杖 (Magic Wand)',
    level: 1,
    fireRate: 1000,
    count: 1,
    speed: 8,
    active: true,
    lastFired: 0
};

// 2. オービタルシールド（自分の周りを回る水色の玉）
const orbitalShieldData = {
    id: 'orbitalShield',
    name: 'オービタル・シールド',
    level: 0, // 0は未取得
    count: 1, // シールドの数
    orbitRadius: 75, // 修正4: 軌道半径を少し広げる (60 -> 75)
    orbitSpeed: 0.05, // ラジアン/フレーム
    angle: 0,
    active: false,
    hitCooldowns: new WeakMap() // 修正3: 敵単位でのヒットクールダウン管理
};

// 3. ブーメラン（最後に動いた方向へ飛んで戻ってくる緑の三角形）
const boomerangData = {
    id: 'boomerang',
    name: 'ブーメラン',
    level: 0,
    fireRate: 2000,
    speed: 10,
    count: 1,
    maxDistance: 300,
    active: false,
    lastFired: 0
};

// ======= プレイヤー =======
const player = {
    x: 0,
    y: 0,
    radius: 15,
    baseSpeed: 3,
    speedMultiplier: 1,
    color: '#3498db',

    // 最後に動いた方向（ブーメラン用、初期値は右固定）
    lastDirX: 1,
    lastDirY: 0,

    hp: 100,
    baseMaxHp: 100,
    maxHpMultiplier: 1,
    invincibleTimer: 0,
    invincibleDuration: 60,

    level: 1,
    exp: 0,
    maxExp: 10,

    // 全体ダメージ倍率（ショップ強化用）
    damageMultiplier: 1,

    getMaxHp() { return Math.floor(this.baseMaxHp * this.maxHpMultiplier); },
    getSpeed() { return this.baseSpeed * this.speedMultiplier; },

    init() {
        this.x = mapWidth / 2;
        this.y = mapHeight / 2;
        this.maxHpMultiplier = 1;
        this.speedMultiplier = 1;
        this.damageMultiplier = 1;
        this.hp = this.getMaxHp();
        this.invincibleTimer = 0;

        this.level = 1;
        this.exp = 0;
        let baseStartExp = 5;
        this.maxExp = Math.floor(baseStartExp * diffConfig[currentDifficulty].expMultiplier);

        this.lastDirX = 1;
        this.lastDirY = 0;

        isMagnetActive = false;
        flashScreenTimer = 0;
        enemyProjectiles = [];
        explosions = [];
        barrels = [];

        // 武器のリセット
        magicWandData.level = 1;
        magicWandData.fireRate = 1000;
        magicWandData.count = 1;
        magicWandData.speed = 8;
        magicWandData.active = true;

        orbitalShieldData.level = 0;
        orbitalShieldData.count = 1;
        orbitalShieldData.active = false;

        boomerangData.level = 0;
        boomerangData.fireRate = 2000;
        boomerangData.count = 1;
        boomerangData.speed = 10;
        boomerangData.maxDistance = 300;
        boomerangData.active = false;

        coins = 0;
        currentStage = 1;
        killCount = 0;
        bossSpawnedInStage = false;
        this.updateUI();
        initStage();
    },

    update() {
        if (gameState !== STATE.PLAYING) return;

        let dx = 0;
        let dy = 0;

        if (keys.w || keys.ArrowUp) dy -= 1;
        if (keys.s || keys.ArrowDown) dy += 1;
        if (keys.a || keys.ArrowLeft) dx -= 1;
        if (keys.d || keys.ArrowRight) dx += 1;

        if (dx !== 0 || dy !== 0) {
            const length = Math.sqrt(dx * dx + dy * dy);
            dx /= length;
            dy /= length;
            // 最後の移動方向を記憶
            this.lastDirX = dx;
            this.lastDirY = dy;
        }

        this.x += dx * this.getSpeed();
        this.y += dy * this.getSpeed();

        // マップ範囲外に出ないようにクランプ（修正5）
        this.x = Math.max(this.radius, Math.min(mapWidth - this.radius, this.x));
        this.y = Math.max(this.radius, Math.min(mapHeight - this.radius, this.y));

        if (this.invincibleTimer > 0) this.invincibleTimer--;
    },

    draw() {
        if (this.invincibleTimer > 0 && Math.floor(Date.now() / 100) % 2 === 0) return;

        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(cw / 2, ch / 2, this.radius, 0, Math.PI * 2);
        ctx.fill();
    },

    takeDamage(amount) {
        if (this.invincibleTimer <= 0 && gameState === STATE.PLAYING) {
            this.hp -= amount;
            this.invincibleTimer = this.invincibleDuration;

            if (this.hp <= 0) {
                this.hp = 0;
                triggerGameOver();
            }
            this.updateUI();
        }
    },

    gainExp(amount) {
        this.exp += amount;
        if (this.exp >= this.maxExp) {
            this.exp -= this.maxExp;
            this.level++;

            // 序盤はサクサク上がるように緩和（Lv10までは固定値+5、それ以降は1.5倍の指数増加）
            let unscaledNextExp = this.maxExp / diffConfig[currentDifficulty].expMultiplier;
            if (this.level <= 10) {
                unscaledNextExp += 5;
            } else {
                unscaledNextExp = Math.floor(unscaledNextExp * 1.5);
            }
            this.maxExp = Math.max(1, Math.floor(unscaledNextExp * diffConfig[currentDifficulty].expMultiplier));

            triggerLevelUp();
        }
        this.updateUI();
    },

    addCoin(amount) {
        coins += amount;
        this.updateUI();
    },

    updateUI() {
        const hpPercent = Math.max(0, this.hp / this.getMaxHp()) * 100;
        uiHpBar.style.width = hpPercent + '%';
        uiHpBar.style.backgroundColor = hpPercent < 30 ? '#e74c3c' : '#3498db';

        const expPercent = Math.min(100, (this.exp / this.maxExp) * 100);
        uiExpBar.style.width = expPercent + '%';
        uiExpText.innerText = `レベル ${this.level}`;

        uiStageText.innerText = `ステージ ${currentStage}`;
        uiCoinText.innerText = coins;
    }
};

// ======= ステージ進行管理 =======
function initStage() {
    enemiesGenerated = 0;
    enemiesKilledInStage = 0;
    bossSpawnedInStage = false;
    isBossWarningActive = false;
    warningScreen.classList.add('hidden');
    enemyProjectiles = [];
    explosions = [];

    // ステージごとのインフレ設定
    stageConfig.totalEnemies = 20 + (currentStage * 10);
    stageConfig.maxOnScreen = 5 + (currentStage * 5);
    stageConfig.spawnInterval = Math.max(200, 1500 - (currentStage * 100));
    stageConfig.enemySpeedMultiplier = 1 + (currentStage * 0.1);

    stageConfig.enemyHp = (1 + Math.floor(currentStage / 3)) * diffConfig[currentDifficulty].enemyHpMult;

    // 新要素③: ステージ開始時に爆発タルをランダムに5〜10個配置
    barrels = [];
    const numBarrels = 5 + Math.floor(Math.random() * 6);
    for (let i = 0; i < numBarrels; i++) {
        // マップ端から少し内側に配置
        const bx = 100 + Math.random() * (mapWidth - 200);
        const by = 100 + Math.random() * (mapHeight - 200);
        barrels.push(new Barrel(bx, by));
    }

    player.updateUI();
}

function checkStageClear() {
    // 規定数を倒したらステージクリア
    if (enemiesKilledInStage >= stageConfig.totalEnemies) {
        enemies = []; // 残敵消去
        triggerShop();
    }
}

// ======= 新機能アイテム・ギミック =======
class Barrel {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.width = 30;
        this.height = 40;
        this.active = true;
    }

    draw() {
        if (!this.active) return;
        const screenX = this.x - camera.x + cw / 2;
        const screenY = this.y - camera.y + ch / 2;
        if (screenX < -this.width || screenX > cw + this.width || screenY < -this.height || screenY > ch + this.height) return;

        ctx.fillStyle = '#8e44ad'; // 少し紫がかった木の色を想定
        ctx.fillRect(screenX - this.width / 2, screenY - this.height / 2, this.width, this.height);
        // タルの装飾
        ctx.strokeStyle = '#2c3e50';
        ctx.lineWidth = 3;
        ctx.strokeRect(screenX - this.width / 2, screenY - this.height / 2, this.width, this.height);
        ctx.beginPath();
        ctx.moveTo(screenX - this.width / 2 + 2, screenY - 5);
        ctx.lineTo(screenX + this.width / 2 - 2, screenY - 5);
        ctx.moveTo(screenX - this.width / 2 + 2, screenY + 5);
        ctx.lineTo(screenX + this.width / 2 - 2, screenY + 5);
        ctx.stroke();
    }
}

class Explosion {
    constructor(x, y, radius) {
        this.x = x;
        this.y = y;
        this.maxRadius = radius;
        this.currentRadius = 5;
        this.alpha = 1;
        this.active = true;
    }
    update() {
        this.currentRadius += 10;
        this.alpha -= 0.05;
        if (this.alpha <= 0 || this.currentRadius >= this.maxRadius) {
            this.active = false;
        }
    }
    draw() {
        if (!this.active) return;
        const screenX = this.x - camera.x + cw / 2;
        const screenY = this.y - camera.y + ch / 2;
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.alpha);
        ctx.fillStyle = '#e67e22';
        ctx.beginPath();
        ctx.arc(screenX, screenY, this.currentRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// ======= ドロップアイテム =======
class ItemDrop {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type; // 'gem', 'coin', 'magnet', 'bomb', 'meat'
        this.active = true;
        this.radius = 8;
    }

    update() {
        if (!this.active) return;

        // 磁石効果適用中ならジェムは強制的にプレイヤーへ向かう
        if (isMagnetActive && this.type === 'gem') {
            const dx = player.x - this.x;
            const dy = player.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const magnetSpeed = 12; // 吸収速度

            if (dist < player.radius) {
                player.gainExp(1);
                this.active = false;
                return;
            }
            this.x += (dx / Math.max(1, dist)) * magnetSpeed;
            this.y += (dy / Math.max(1, dist)) * magnetSpeed;
            return;
        }

        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const pickupRadius = player.radius + 30;

        if (dist < pickupRadius) {
            if (dist < player.radius) {
                if (this.type === 'gem') player.gainExp(1);
                else if (this.type === 'coin') player.addCoin(1);
                else if (this.type === 'meat') {
                    // 最大HPの30%回復
                    player.hp = Math.min(player.getMaxHp(), player.hp + player.getMaxHp() * 0.3);
                    player.updateUI();
                }
                else if (this.type === 'bomb') {
                    // フラッシュ開始、ボス以外の画面内敵を抹殺
                    flashScreenTimer = 10;
                    for (let enemy of enemies) {
                        if (enemy.active && !(enemy instanceof BossEnemy)) {
                            // 画面内判定
                            const screenX = enemy.x - camera.x + cw / 2;
                            const screenY = enemy.y - camera.y + ch / 2;
                            if (screenX >= -50 && screenX <= cw + 50 && screenY >= -50 && screenY <= ch + 50) {
                                enemy.hp = 0; // 即死
                                enemy.takeDamage(1); // 死亡処理ルーチン発火
                            }
                        }
                    }
                }
                else if (this.type === 'magnet') {
                    isMagnetActive = true;
                    magnetTimer = performance.now();
                }

                this.active = false;
            } else {
                const baseMagnetSpeed = 6;
                this.x += (dx / dist) * baseMagnetSpeed;
                this.y += (dy / dist) * baseMagnetSpeed;
            }
        }
    }

    draw() {
        const screenX = this.x - camera.x + cw / 2;
        const screenY = this.y - camera.y + ch / 2;
        if (screenX < -10 || screenX > cw + 10 || screenY < -10 || screenY > ch + 10) return;

        ctx.beginPath();
        if (this.type === 'gem') {
            ctx.fillStyle = '#2ecc71'; // 緑
            ctx.moveTo(screenX, screenY - 6);
            ctx.lineTo(screenX + 6, screenY);
            ctx.lineTo(screenX, screenY + 6);
            ctx.lineTo(screenX - 6, screenY);
            ctx.fill();
        } else if (this.type === 'coin') {
            ctx.fillStyle = '#f1c40f'; // 黄色
            const size = 10;
            ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
            ctx.strokeStyle = '#d4ac0d';
            ctx.strokeRect(screenX - size / 2, screenY - size / 2, size, size);
        } else if (this.type === 'meat') {
            ctx.fillStyle = '#ff7675'; // 肉（ピンク）
            ctx.fillRect(screenX - 8, screenY - 6, 16, 12);
        } else if (this.type === 'bomb') {
            ctx.fillStyle = '#2d3436'; // 爆弾（黒）
            ctx.arc(screenX, screenY, 8, 0, Math.PI * 2);
            ctx.fill();
        } else if (this.type === 'magnet') {
            ctx.strokeStyle = '#0984e3'; // 磁石（青のU字）
            ctx.lineWidth = 4;
            ctx.arc(screenX, screenY, 8, Math.PI, 0);
            ctx.stroke();
        }
    }
}

function dropItem(x, y) {
    // 新要素①：1%の確率でお助けアイテムドロップ
    if (Math.random() < 0.01) {
        const specialRand = Math.random();
        if (specialRand < 0.33) drops.push(new ItemDrop(x, y, 'magnet'));
        else if (specialRand < 0.66) drops.push(new ItemDrop(x, y, 'bomb'));
        else drops.push(new ItemDrop(x, y, 'meat'));
        return; // スペシャルアイテムが出たらジェム等は今回は無し
    }

    // 70%でジェム、30%でコイン
    const type = Math.random() < 0.7 ? 'gem' : 'coin';
    drops.push(new ItemDrop(x, y, type));
}

// ======= 敵 =======
class Enemy {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.width = 20;
        this.height = 20;
        // わずかな速度の揺らぎ＋ステージ倍率
        this.speed = (1 + Math.random() * 0.5) * stageConfig.enemySpeedMultiplier;
        this.color = '#e74c3c';
        this.hp = stageConfig.enemyHp;
        this.active = true;
    }

    takeDamage(amount) {
        // プレイヤーの攻撃力倍率を適用 (簡易化のため1ずつ減らす仕様を拡張)
        const damage = amount * player.damageMultiplier;
        this.hp -= damage;
        if (this.hp <= 0) {
            this.active = false;
            killCount++;
            enemiesKilledInStage++;
            dropItem(this.x, this.y);
            checkStageClear();
        }
    }

    update() {
        if (!this.active) return;
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 0) {
            this.x += (dx / dist) * this.speed;
            this.y += (dy / dist) * this.speed;
        }

        const radiusDist = this.width / 2 + player.radius;
        if (dist < radiusDist) {
            player.takeDamage(10);
        }
    }

    draw() {
        const screenX = this.x - camera.x + cw / 2;
        const screenY = this.y - camera.y + ch / 2;
        if (screenX < -this.width || screenX > cw + this.width || screenY < -this.height || screenY > ch + this.height) return;

        ctx.fillStyle = this.color;
        ctx.fillRect(screenX - this.width / 2, screenY - this.height / 2, this.width, this.height);
    }
}

// ======= 新規エネミー：突進型（紫の三角形） =======
class DashEnemy extends Enemy {
    constructor(x, y) {
        super(x, y);
        this.color = '#9b59b6'; // 紫
        this.speed = stageConfig.enemySpeedMultiplier * 1.2;
        this.width = 25;
        this.height = 25;
        this.hp = stageConfig.enemyHp * 0.8; // 通常より少し脆い

        this.state = 'chase'; // 'chase', 'prepare', 'dash'
        this.stateTimer = 0;
        this.dashVx = 0;
        this.dashVy = 0;
        this.angle = 0;
    }

    update() {
        if (!this.active) return;

        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        this.angle = Math.atan2(dy, dx);

        if (this.state === 'chase') {
            if (dist > 0) {
                this.x += (dx / dist) * this.speed;
                this.y += (dy / dist) * this.speed;
            }
            // プレイヤーに近づいたら停止準備
            if (dist < 200) {
                this.state = 'prepare';
                this.stateTimer = performance.now();
            }
        }
        else if (this.state === 'prepare') {
            // 0.8秒間ピタッと停止して狙いを定める
            if (performance.now() - this.stateTimer > 800) {
                this.state = 'dash';
                this.stateTimer = performance.now();
                const dashSpeed = this.speed * 4; // 4倍速で突進
                this.dashVx = (dx / dist) * dashSpeed;
                this.dashVy = (dy / dist) * dashSpeed;
            }
        }
        else if (this.state === 'dash') {
            this.x += this.dashVx;
            this.y += this.dashVy;
            // はるか遠くへ行かないよう、または一定時間で追跡に戻す
            if (performance.now() - this.stateTimer > 1000) {
                this.state = 'chase';
            }
        }

        const radiusDist = this.width / 2 + player.radius;
        if (dist < radiusDist) {
            player.takeDamage(10);
        }
    }

    draw() {
        const screenX = this.x - camera.x + cw / 2;
        const screenY = this.y - camera.y + ch / 2;
        if (screenX < -this.width || screenX > cw + this.width || screenY < -this.height || screenY > ch + this.height) return;

        ctx.fillStyle = this.color;
        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.rotate(this.angle); // プレイヤーの方を向く
        ctx.beginPath();
        ctx.moveTo(this.width / 2, 0); // 尖った部分を前に
        ctx.lineTo(-this.width / 2, this.height / 2);
        ctx.lineTo(-this.width / 2, -this.height / 2);
        ctx.fill();
        ctx.restore();
    }
}

// ======= 新規エネミー：遠距離攻撃型（オレンジのひし形） =======
class RangedEnemy extends Enemy {
    constructor(x, y) {
        super(x, y);
        this.color = '#e67e22'; // オレンジ
        this.speed = stageConfig.enemySpeedMultiplier * 0.9;
        this.width = 24;
        this.height = 24;
        this.hp = stageConfig.enemyHp * 1.0;

        this.lastShotTime = performance.now();
        this.shotInterval = 2500; // 2.5秒に1回
        this.targetDist = 250; // プレイヤーの距離250を維持しようとする
    }

    update(currentTimestamp) {
        if (!this.active) return;
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 0) {
            // 近づきすぎたら離れ、遠ければ近づく
            let moveDir = 1;
            if (dist < this.targetDist - 20) moveDir = -1;
            else if (dist > this.targetDist + 20) moveDir = 1;
            else moveDir = 0; // 適正距離なら横に動くなどできるが簡略化

            this.x += (dx / dist) * this.speed * moveDir;
            this.y += (dy / dist) * this.speed * moveDir;
        }

        // 弾を撃つ
        if (currentTimestamp - this.lastShotTime > this.shotInterval) {
            this.lastShotTime = currentTimestamp;
            enemyProjectiles.push(new EnemyProjectile(this.x, this.y, player.x, player.y));
        }

        const radiusDist = this.width / 2 + player.radius;
        if (dist < radiusDist) {
            player.takeDamage(10);
        }
    }

    draw() {
        if (!this.active) return;
        const screenX = this.x - camera.x + cw / 2;
        const screenY = this.y - camera.y + ch / 2;
        if (screenX < -this.width || screenX > cw + this.width || screenY < -this.height || screenY > ch + this.height) return;

        ctx.fillStyle = this.color;
        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.rotate(Math.PI / 4); // ひし形にする
        ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
        ctx.restore();
    }
}

// 敵の弾
class EnemyProjectile {
    constructor(x, y, targetX, targetY) {
        this.x = x;
        this.y = y;
        this.radius = 6;
        this.speed = stageConfig.enemySpeedMultiplier * 3;
        this.active = true;

        const dx = targetX - x;
        const dy = targetY - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
            this.vx = (dx / dist) * this.speed;
            this.vy = (dy / dist) * this.speed;
        } else {
            this.vx = this.speed; this.vy = 0;
        }
    }

    update() {
        if (!this.active) return;
        this.x += this.vx;
        this.y += this.vy;

        // 画面外やマップ外で消滅
        if (this.x < 0 || this.x > mapWidth || this.y < 0 || this.y > mapHeight) {
            this.active = false;
        }

        // プレイヤーとの当たり判定
        const dist = Math.sqrt((player.x - this.x) ** 2 + (player.y - this.y) ** 2);
        if (dist < this.radius + player.radius) {
            player.takeDamage(5); // 敵弾のダメージ
            this.active = false;
        }
    }

    draw() {
        if (!this.active) return;
        const screenX = this.x - camera.x + cw / 2;
        const screenY = this.y - camera.y + ch / 2;
        ctx.fillStyle = '#c0392b';
        ctx.beginPath();
        ctx.arc(screenX, screenY, this.radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ======= 新規エネミー：巨大ボス =======
class BossEnemy extends Enemy {
    constructor(x, y) {
        super(x, y);
        this.color = '#8b0000'; // 濃い赤
        this.width = 60;
        this.height = 60;
        // HPは通常の30倍
        this.hp = stageConfig.enemyHp * 30;
        this.speed = stageConfig.enemySpeedMultiplier * 0.7; // 少し遅い
    }

    takeDamage(amount) {
        const damage = amount * player.damageMultiplier;
        this.hp -= damage;
        if (this.hp <= 0) {
            this.active = false;
            killCount++;
            enemiesKilledInStage++;
            // ボス討伐報酬：大量のジェムとコイン
            for (let i = 0; i < 8; i++) drops.push(new ItemDrop(this.x + (Math.random() - 0.5) * 40, this.y + (Math.random() - 0.5) * 40, 'gem'));
            for (let i = 0; i < 8; i++) drops.push(new ItemDrop(this.x + (Math.random() - 0.5) * 40, this.y + (Math.random() - 0.5) * 40, 'coin'));
            checkStageClear();
        }
    }
}

let lastSpawnTime = 0;
function spawnEnemy(currentTimestamp) {
    if (enemiesKilledInStage >= stageConfig.totalEnemies) return;
    if (enemies.length >= stageConfig.maxOnScreen) return;
    if (enemiesGenerated >= stageConfig.totalEnemies) return;

    // ギミックB: ボス出現判定 (ステージの中盤＝敵生成数が総数の半分を超えた時)
    if (!bossSpawnedInStage && enemiesGenerated >= stageConfig.totalEnemies * 0.5) {
        bossSpawnedInStage = true; // フラグオン
        isBossWarningActive = true;
        bossWarningStartTime = currentTimestamp;
        warningScreen.classList.remove('hidden');
        return; // 少し待ってからボス専用スポーンを行うため今回は抜ける
    }

    if (isBossWarningActive) {
        if (currentTimestamp - bossWarningStartTime > 3000) {
            isBossWarningActive = false;
            warningScreen.classList.add('hidden');

            let x = player.x;
            let y = player.y - ch / 2 - 150; // 上部から確実に出現
            x = Math.max(0, Math.min(mapWidth, x));
            y = Math.max(0, Math.min(mapHeight, y));

            enemies.push(new BossEnemy(x, y));
            enemiesGenerated++;
        }
        return; // WARNING中およびボス出現の瞬間は通常の敵を湧かせない
    }

    if (currentTimestamp - lastSpawnTime > stageConfig.spawnInterval) {
        let x, y;
        const side = Math.floor(Math.random() * 4);
        const margin = 100;

        if (side === 0) { x = player.x + (Math.random() - 0.5) * cw; y = player.y - ch / 2 - margin; }
        else if (side === 1) { x = player.x + (Math.random() - 0.5) * cw; y = player.y + ch / 2 + margin; }
        else if (side === 2) { x = player.x - cw / 2 - margin; y = player.y + (Math.random() - 0.5) * ch; }
        else { x = player.x + cw / 2 + margin; y = player.y + (Math.random() - 0.5) * ch; }

        x = Math.max(0, Math.min(mapWidth, x));
        y = Math.max(0, Math.min(mapHeight, y));

        // ギミックA: 15%で突進、ギミックC(新要素2): 15%で遠距離
        const rand = Math.random();
        if (rand < 0.15) {
            enemies.push(new DashEnemy(x, y));
        } else if (rand < 0.3) {
            enemies.push(new RangedEnemy(x, y));
        } else {
            enemies.push(new Enemy(x, y));
        }

        enemiesGenerated++;
        lastSpawnTime = currentTimestamp;
    }
}

// ======= 武器（射出物） =======

// ベースとなる飛び道具（魔法の杖・ブーメラン）
class Projectile {
    constructor(x, y, targetX, targetY, type) {
        this.x = x;
        this.y = y;
        this.type = type; // 'magic' or 'boomerang'
        this.active = true;
        this.hitEnemies = new Set(); // 貫通ヒット記録用

        if (type === 'magic') {
            this.radius = 8;
            this.speed = magicWandData.speed;
            this.color = '#f1c40f'; // 黄色の円
            this.piercing = false;
        } else if (type === 'boomerang') {
            this.radius = 12;
            this.speed = boomerangData.speed;
            this.color = '#2ecc71'; // 緑の三角形ベース
            this.piercing = true;
            this.startX = x;
            this.startY = y;
            this.returning = false;
            this.angle = 0; // 回転描画用
        }

        const dx = targetX - x;
        const dy = targetY - y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 0) {
            this.vx = (dx / dist) * this.speed;
            this.vy = (dy / dist) * this.speed;
        } else {
            this.vx = this.speed;
            this.vy = 0;
        }
    }

    update() {
        if (!this.active) return;

        if (this.type === 'boomerang') {
            // ブーメラン特有の移動ロジック（一定距離で戻る）
            this.angle += 0.2;

            if (!this.returning) {
                this.x += this.vx;
                this.y += this.vy;
                const distMoved = Math.sqrt((this.x - this.startX) ** 2 + (this.y - this.startY) ** 2);
                if (distMoved >= boomerangData.maxDistance) {
                    this.returning = true;
                    this.hitEnemies.clear(); // 戻り時にもう一度当たるようにする
                }
            } else {
                // プレイヤーの元へ戻る
                const dx = player.x - this.x;
                const dy = player.y - this.y;
                const distToPlayer = Math.sqrt(dx * dx + dy * dy);
                if (distToPlayer < player.radius * 2) {
                    this.active = false; // キャッチ
                    return;
                }
                this.x += (dx / distToPlayer) * this.speed;
                this.y += (dy / distToPlayer) * this.speed;
            }
        } else {
            // 魔法の杖（直線）
            this.x += this.vx;
            this.y += this.vy;
            const distFromPlayer = Math.sqrt((this.x - player.x) ** 2 + (this.y - player.y) ** 2);
            if (distFromPlayer > Math.max(cw, ch) * 1.5) {
                this.active = false;
            }
        }

        // 敵との当たり判定
        for (let enemy of enemies) {
            if (!enemy.active) continue;
            if (this.hitEnemies.has(enemy)) continue;

            const dx = enemy.x - this.x;
            const dy = enemy.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < this.radius + enemy.width / 2) {
                enemy.takeDamage(1); // 1ヒット1ダメージ（武器によらずベース）
                this.hitEnemies.add(enemy);
                if (!this.piercing) {
                    this.active = false;
                    break;
                }
            }
        }

        // 新要素③: 爆発タルとの当たり判定
        if (this.active) {
            for (let barrel of barrels) {
                if (!barrel.active) continue;
                // タルの四角形との簡易円判定
                const dx = barrel.x - this.x;
                const dy = barrel.y - this.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < this.radius + Math.max(barrel.width, barrel.height) / 2) {
                    // タルの起爆
                    barrel.active = false;
                    explosions.push(new Explosion(barrel.x, barrel.y, 150));

                    // 周囲の敵に爆発ダメージ
                    for (let enemy of enemies) {
                        if (!enemy.active) continue;
                        const edx = enemy.x - barrel.x;
                        const edy = enemy.y - barrel.y;
                        if (Math.sqrt(edx * edx + edy * edy) < 150) {
                            enemy.takeDamage(200);
                        }
                    }
                    if (!this.piercing) {
                        this.active = false;
                        break;
                    }
                }
            }
        }
    }

    draw() {
        const screenX = this.x - camera.x + cw / 2;
        const screenY = this.y - camera.y + ch / 2;

        ctx.fillStyle = this.color;
        ctx.beginPath();

        if (this.type === 'boomerang') {
            // 回転する三角形
            ctx.save();
            ctx.translate(screenX, screenY);
            ctx.rotate(this.angle);
            ctx.moveTo(0, -this.radius);
            ctx.lineTo(this.radius, this.radius);
            ctx.lineTo(-this.radius, this.radius);
            ctx.fill();
            ctx.restore();
        } else {
            ctx.arc(screenX, screenY, this.radius, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

// ======= 武器管理と発射ロジック =======
function updateWeapons(currentTimestamp) {
    if (gameState !== STATE.PLAYING) return;

    // 1. 魔法の杖
    if (magicWandData.active && enemies.length > 0 && currentTimestamp - magicWandData.lastFired > magicWandData.fireRate) {
        // 最も近い敵
        let nearestEnemy = null;
        let minDst = Infinity;
        for (let enemy of enemies) {
            if (!enemy.active) continue;
            const dist = Math.sqrt((enemy.x - player.x) ** 2 + (enemy.y - player.y) ** 2);
            if (dist < minDst) { minDst = dist; nearestEnemy = enemy; }
        }

        if (nearestEnemy) {
            // 修正1: 杖の角度（偶数でも必ず真正面に1発、残りを扇状に分散させる中央揃えロジック）
            const baseAngle = Math.atan2(nearestEnemy.y - player.y, nearestEnemy.x - player.x);
            const spread = 0.3; // 広がり角度

            for (let i = 0; i < magicWandData.count; i++) {
                // n番目の弾のオフセット（0, 1, -1, 2, -2... と交互に配置する）
                let offsetMultiplier = 0;
                if (i > 0) {
                    // 1, 2, 3, 4 -> 1, -1, 2, -2 になる数学的変換
                    offsetMultiplier = Math.ceil(i / 2) * (i % 2 === 0 ? -1 : 1);
                }
                const angle = baseAngle + (offsetMultiplier * spread);

                const targetX = player.x + Math.cos(angle) * 100;
                const targetY = player.y + Math.sin(angle) * 100;
                projectiles.push(new Projectile(player.x, player.y, targetX, targetY, 'magic'));
            }
            magicWandData.lastFired = currentTimestamp;
        }
    }

    // 2. オービタルシールドの更新（常にプレイヤーの周りを回る、直接ダメージ）
    if (orbitalShieldData.active) {
        orbitalShieldData.angle = (orbitalShieldData.angle + orbitalShieldData.orbitSpeed) % (Math.PI * 2);

        // 修正3: オービタルの当たり判定を確実にする
        for (let enemy of enemies) {
            if (!enemy.active) continue;

            // 敵のシールドクールダウンを取得
            let cooldown = orbitalShieldData.hitCooldowns.get(enemy) || 0;
            if (currentTimestamp < cooldown) continue; // クールダウン中ならヒットしない

            for (let i = 0; i < orbitalShieldData.count; i++) {
                const ballAngle = orbitalShieldData.angle + (i * ((Math.PI * 2) / orbitalShieldData.count));
                const ballX = player.x + Math.cos(ballAngle) * orbitalShieldData.orbitRadius;
                const ballY = player.y + Math.sin(ballAngle) * orbitalShieldData.orbitRadius;

                const dist = Math.sqrt((enemy.x - ballX) ** 2 + (enemy.y - ballY) ** 2);
                if (dist < 10 + enemy.width / 2) {
                    enemy.takeDamage(1);
                    // 約0.5秒間、同じ敵に対するシールドの連続ヒットを防ぐ
                    orbitalShieldData.hitCooldowns.set(enemy, currentTimestamp + 500);
                    break; // このフレームでは1つのシールドの判定のみで十分
                }
            }
        }
    }

    // 3. ブーメラン
    if (boomerangData.active && currentTimestamp - boomerangData.lastFired > boomerangData.fireRate) {
        // 修正2: ブーメランの方向を最後に移動した方向の「逆（背中側）」に飛ばす
        // かつ杖と同様に真正面1発＋扇状拡散のロジックに変更
        const baseAngle = Math.atan2(-player.lastDirY, -player.lastDirX);
        const spread = 0.4;

        for (let i = 0; i < boomerangData.count; i++) {
            let offsetMultiplier = 0;
            if (i > 0) {
                offsetMultiplier = Math.ceil(i / 2) * (i % 2 === 0 ? -1 : 1);
            }
            const angle = baseAngle + (offsetMultiplier * spread);

            const targetX = player.x + Math.cos(angle) * 100;
            const targetY = player.y + Math.sin(angle) * 100;
            projectiles.push(new Projectile(player.x, player.y, targetX, targetY, 'boomerang'));
        }
        boomerangData.lastFired = currentTimestamp;
    }
}

function drawOrbitalShield() {
    if (!orbitalShieldData.active) return;
    for (let i = 0; i < orbitalShieldData.count; i++) {
        const ballAngle = orbitalShieldData.angle + (i * ((Math.PI * 2) / orbitalShieldData.count));
        const ballX = player.x + Math.cos(ballAngle) * orbitalShieldData.orbitRadius;
        const ballY = player.y + Math.sin(ballAngle) * orbitalShieldData.orbitRadius;

        const screenX = ballX - camera.x + cw / 2;
        const screenY = ballY - camera.y + ch / 2;

        ctx.fillStyle = '#00ffff'; // 水色
        ctx.beginPath();
        ctx.arc(screenX, screenY, 10, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ====== 描画機能 ======
function drawGrid() {
    // 修正5: 無限背景ではなく限定範囲の描画にする
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    const gridSize = 50;

    ctx.beginPath();
    // 画面に映る部分（カメラ座標から計算）のマップ内のグリッドだけを描画
    const startX = Math.max(0, camera.x - cw / 2);
    const endX = Math.min(mapWidth, camera.x + cw / 2);
    const startY = Math.max(0, camera.y - ch / 2);
    const endY = Math.min(mapHeight, camera.y + ch / 2);

    // 縦線
    for (let x = Math.floor(startX / gridSize) * gridSize; x <= endX; x += gridSize) {
        const screenX = x - camera.x + cw / 2;
        ctx.moveTo(screenX, Math.max(0, -camera.y + ch / 2));
        ctx.lineTo(screenX, Math.min(ch, mapHeight - camera.y + ch / 2));
    }
    // 横線
    for (let y = Math.floor(startY / gridSize) * gridSize; y <= endY; y += gridSize) {
        const screenY = y - camera.y + ch / 2;
        ctx.moveTo(Math.max(0, -camera.x + cw / 2), screenY);
        ctx.lineTo(Math.min(cw, mapWidth - camera.x + cw / 2), screenY);
    }
    ctx.stroke();

    // マップの境界線の描画（赤色で囲う）
    ctx.strokeStyle = 'rgba(231, 76, 60, 0.8)'; // 半透明の赤
    ctx.lineWidth = 5;
    ctx.strokeRect(
        -camera.x + cw / 2,
        -camera.y + ch / 2,
        mapWidth,
        mapHeight
    );
}

// ====== タイトル画面の処理 ======
diffButtons.forEach(btn => {
    btn.onclick = (e) => {
        currentDifficulty = parseInt(e.target.dataset.diff);
        titleScreen.classList.add('hidden');
        player.init();
        enemies = [];
        projectiles = [];
        drops = [];
        lastFrameTime = performance.now();
        gameState = STATE.PLAYING;
    };
});

// ====== 状態遷移（レベルアップ・ショップ・ゲームオーバー） ======

function triggerLevelUp() {
    gameState = STATE.LEVEL_UP;
    levelUpModal.classList.remove('hidden');
    upgradeOptionsDiv.innerHTML = '';

    // 全ての武器・強化候補
    const possibleUpgrades = [
        {
            title: '魔法の杖の強化', desc: '弾数+1',
            condition: () => magicWandData.active,
            apply: () => { magicWandData.count++; }
        },
        {
            title: '魔法の杖の速度', desc: '連射速度上昇',
            condition: () => magicWandData.active,
            apply: () => { magicWandData.fireRate = Math.max(200, magicWandData.fireRate * 0.8); }
        },
        {
            title: '【新規】オービタル', desc: '周囲を守る水色のバリアを取得',
            condition: () => !orbitalShieldData.active,
            apply: () => { orbitalShieldData.active = true; orbitalShieldData.level = 1; orbitalShieldData.count = 2; }
        },
        {
            title: 'オービタルの強化', desc: 'バリアの個数+1',
            condition: () => orbitalShieldData.active,
            apply: () => { orbitalShieldData.count++; orbitalShieldData.level++; }
        },
        {
            title: '【新規】ブーメラン', desc: '最後に移動した方向へ貫通攻撃',
            condition: () => !boomerangData.active,
            apply: () => { boomerangData.active = true; boomerangData.level = 1; }
        },
        {
            title: 'ブーメランの強化', desc: '発射数+1',
            condition: () => boomerangData.active,
            apply: () => { boomerangData.count++; boomerangData.level++; }
        }
    ];

    // 条件を満たすものをフィルタリング
    let availableOpts = possibleUpgrades.filter(opt => opt.condition());
    // もし候補が足りなければ、基礎強化を補填
    if (availableOpts.length < 3) {
        availableOpts.push({ title: 'HP回復', desc: '体力を50回復します', condition: () => true, apply: () => { player.hp = Math.min(player.getMaxHp(), player.hp + 50); player.updateUI(); } });
    }

    // ランダムに3個選択
    const shuffled = availableOpts.sort(() => 0.5 - Math.random());
    const selectedOptions = shuffled.slice(0, 3);

    selectedOptions.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'upgrade-btn';
        btn.innerHTML = `<strong>${opt.title}</strong><br><span style="font-size:14px; color:#ccc;">${opt.desc}</span>`;
        btn.onclick = () => { opt.apply(); resumeGame(); };
        upgradeOptionsDiv.appendChild(btn);
    });
}

function triggerShop() {
    gameState = STATE.SHOP;
    shopModal.classList.remove('hidden');
    refreshShopUI();
}

function refreshShopUI() {
    shopCoinText.innerText = coins;
    shopOptionsDiv.innerHTML = '';

    const shopItems = [
        { title: '最大HPアップ', desc: '最大HPが20%増加', price: 10, apply: () => { player.maxHpMultiplier += 0.2; player.hp = player.getMaxHp(); } },
        { title: '移動速度アップ', desc: '移動速度が10%増加', price: 15, apply: () => { player.speedMultiplier += 0.1; } },
        { title: '全体攻撃力アップ', desc: '敵に与えるダメージが倍増', price: 25, apply: () => { player.damageMultiplier += 0.5; } },
    ];

    shopItems.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'shop-btn';
        if (coins < item.price) btn.disabled = true;

        btn.innerHTML = `
            <strong>${item.title}</strong>
            <span style="font-size:14px; color:#ccc;">${item.desc}</span>
            <span class="shop-price">🪙 ${item.price}</span>`;

        btn.onclick = () => {
            if (coins >= item.price) {
                coins -= item.price;
                item.apply();
                player.updateUI();
                refreshShopUI(); // 所持金とボタンの状態を更新
            }
        };
        shopOptionsDiv.appendChild(btn);
    });
}

nextStageBtn.onclick = () => {
    shopModal.classList.add('hidden');
    currentStage++;
    initStage();
    resumeGame(); // PLAYINGに戻り、時間を補正
};

function resumeGame() {
    levelUpModal.classList.add('hidden');
    gameState = STATE.PLAYING;
    lastFrameTime = performance.now();
    player.updateUI();
}

function triggerGameOver() {
    gameState = STATE.GAME_OVER;
    gameOverModal.classList.remove('hidden');
    finalStageText.innerText = currentStage;
    finalKillsText.innerText = killCount;
}

retryButton.onclick = () => {
    gameOverModal.classList.add('hidden');
    // タイトルへ戻る処理に変更
    titleScreen.classList.remove('hidden');
    gameState = STATE.TITLE;
};

// ====== メインループ ======
function gameLoop(currentTimestamp) {
    if (!lastFrameTime) lastFrameTime = currentTimestamp;

    if (gameState === STATE.TITLE) {
        lastFrameTime = currentTimestamp;
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, cw, ch);
        requestAnimationFrame(gameLoop);
        return;
    }

    if (gameState === STATE.PLAYING) {
        lastFrameTime = currentTimestamp;

        // 磁石持続時間チェック(3秒程度)
        if (isMagnetActive && currentTimestamp - magnetTimer > 3000) {
            isMagnetActive = false;
        }

        // 背景
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, cw, ch);

        player.update();
        camera.x = player.x;
        camera.y = player.y;

        drawGrid();

        spawnEnemy(currentTimestamp);
        updateWeapons(currentTimestamp);

        // 新要素③: バレルと爆発
        barrels.forEach(b => b.draw());
        explosions.forEach(exp => {
            exp.update();
            exp.draw();
        });
        explosions = explosions.filter(exp => exp.active);

        // 新要素②: 敵の射出物
        enemyProjectiles.forEach(ep => {
            ep.update();
            ep.draw();
        });
        enemyProjectiles = enemyProjectiles.filter(ep => ep.active);

        enemies.forEach(enemy => {
            // RangedEnemy は currentTimestamp を要求するため渡す
            if (enemy.update.length > 0) enemy.update(currentTimestamp);
            else enemy.update();
            enemy.draw();
        });
        enemies = enemies.filter(enemy => enemy.active);

        player.draw();

        projectiles.forEach(proj => {
            proj.update();
            proj.draw();
        });
        projectiles = projectiles.filter(proj => proj.active);

        drops.forEach(drop => {
            drop.update();
            drop.draw();
        });
        drops = drops.filter(drop => drop.active);

        // フラッシュ演出
        if (flashScreenTimer > 0) {
            ctx.fillStyle = `rgba(255, 255, 255, ${flashScreenTimer / 10})`;
            ctx.fillRect(0, 0, cw, ch);
            flashScreenTimer--;
        }
    } else {
        lastFrameTime = currentTimestamp;
    }

    drawGrid();

    drops.forEach(d => d.draw());
    enemies.forEach(e => e.draw());
    projectiles.forEach(p => p.draw());
    drawOrbitalShield(); // オービタルは特殊描画（プレイヤー相対）

    player.draw();

    if (gameState === STATE.GAME_OVER || gameState === STATE.SHOP) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, cw, ch);
    }

    requestAnimationFrame(gameLoop);
}

// ====== 初期化 ======
// 最初のフレームリクエストのみ開始
requestAnimationFrame(gameLoop);
