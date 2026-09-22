const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ==========================================
// 1. 포켓몬 정밀 데이터베이스 (종족값 & 진화 정보)
// ==========================================
const POKEMON_DB = {
    1:  { name: '이상해씨', type: 'grass', baseCatchRate: 45, stage: 1, nextEvo: 2, reqStone: '리프의 돌', baseStats: { hp: 45, atk: 49, def: 49, spAtk: 65, spDef: 65, spd: 45 } },
    2:  { name: '이상해풀', type: 'grass', baseCatchRate: 20, stage: 2, nextEvo: 3, reqStone: '리프의 돌', baseStats: { hp: 60, atk: 62, def: 63, spAtk: 80, spDef: 80, spd: 60 } },
    3:  { name: '이상해꽃', type: 'grass', baseCatchRate: 5,  stage: 3, nextEvo: null, reqStone: null, baseStats: { hp: 80, atk: 82, def: 83, spAtk: 100, spDef: 100, spd: 80 } },
    4:  { name: '파이리',   type: 'fire',  baseCatchRate: 45, stage: 1, nextEvo: 5, reqStone: '불꽃의 돌', baseStats: { hp: 39, atk: 52, def: 43, spAtk: 60, spDef: 50, spd: 65 } },
    5:  { name: '리자드',   type: 'fire',  baseCatchRate: 20, stage: 2, nextEvo: 6, reqStone: '불꽃의 돌', baseStats: { hp: 58, atk: 64, def: 58, spAtk: 80, spDef: 65, spd: 80 } },
    6:  { name: '리자몽',   type: 'fire',  baseCatchRate: 5,  stage: 3, nextEvo: null, reqStone: null, baseStats: { hp: 78, atk: 84, def: 78, spAtk: 109, spDef: 85, spd: 100 } },
    7:  { name: '꼬부기',   type: 'water', baseCatchRate: 45, stage: 1, nextEvo: 8, reqStone: '물의 돌', baseStats: { hp: 44, atk: 48, def: 65, spAtk: 50, spDef: 64, spd: 43 } },
    8:  { name: '어니부기', type: 'water', baseCatchRate: 20, stage: 2, nextEvo: 9, reqStone: '물의 돌', baseStats: { hp: 59, atk: 63, def: 80, spAtk: 65, spDef: 80, spd: 58 } },
    9:  { name: '거북왕',   type: 'water', baseCatchRate: 5,  stage: 3, nextEvo: null, reqStone: null, baseStats: { hp: 79, atk: 83, def: 100, spAtk: 85, spDef: 105, spd: 78 } },
    25: { name: '피카츄',   type: 'electric', baseCatchRate: 40, stage: 1, nextEvo: 26, reqStone: '천둥의 돌', baseStats: { hp: 35, atk: 55, def: 40, spAtk: 50, spDef: 50, spd: 90 } },
    26: { name: '라이츄',   type: 'electric', baseCatchRate: 10, stage: 2, nextEvo: null, reqStone: null, baseStats: { hp: 60, atk: 90, def: 55, spAtk: 90, spDef: 80, spd: 110 } }
};

// 유저 인메모리 데이터베이스
const USERS = {};

// ==========================================
// 2. 핵심 계산 알고리즘 함수
// ==========================================

/**
 * 1) 포켓몬 스탯 계산 (원작 공식 적용)
 */
function calculateStats(pokemonId, level) {
    const base = POKEMON_DB[pokemonId].baseStats;
    // HP = ((2 * 종족값) * 레벨 / 100) + 레벨 + 10
    const maxHp = Math.floor(((2 * base.hp) * level) / 100) + level + 10;
    // 기타 스탯 = ((2 * 종족값) * 레벨 / 100) + 5
    const atk = Math.floor(((2 * base.atk) * level) / 100) + 5;
    const def = Math.floor(((2 * base.def) * level) / 100) + 5;
    const spAtk = Math.floor(((2 * base.spAtk) * level) / 100) + 5;
    const spDef = Math.floor(((2 * base.spDef) * level) / 100) + 5;
    const spd = Math.floor(((2 * base.spd) * level) / 100) + 5;

    return { maxHp, atk, def, spAtk, spDef, spd };
}

/**
 * 2) 전투력(Combat Power) 종합 산출
 */
function calculatePower(stats, level) {
    return Math.floor((stats.atk + stats.spAtk + stats.spd) * (level * 0.8) + (stats.def + stats.spDef));
}

/**
 * 3) 원작 정밀 포획 확률 알고리즘
 */
function calculateCatchProbability(ballType, wildMon, partnerPower) {
    // 1) 볼 성능 계수
    const ballRates = { poke: 1.0, super: 1.5, hyper: 2.0, master: 255.0 };
    const ballBonus = ballRates[ballType] || 1.0;

    // 2) 체력 비율 보정 (3*Max - 2*Current) / (3*Max)
    const hpFactor = (3 * wildMon.maxHp - 2 * wildMon.hp) / (3 * wildMon.maxHp);

    // 3) 전투력 차이 보정 (LevelBonus)
    const wildPower = calculatePower(wildMon.stats, wildMon.level);
    let levelBonus = 1.0;
    if (partnerPower >= wildPower) {
        levelBonus = Math.min(1.3, 1.0 + (partnerPower - wildPower) / 2000);
    } else {
        levelBonus = Math.max(0.5, 1.0 - (wildPower - partnerPower) / 1000);
    }

    // 4) 최종 확율 (%) 계산
    const catchRatePercent = hpFactor * wildMon.baseCatchRate * ballBonus * levelBonus;

    return Math.min(100, Math.max(1, catchRatePercent));
}

/**
 * 4) 지수함수 기반 육성 비용 계산 (측정소/훈련소)
 */
function getTrainingCost(level) {
    // Cost = 10,000 * (Level ^ 1.5)
    return Math.floor(10000 * Math.pow(level, 1.5));
}

// ==========================================
// 3. WebSocket 요청 처리기
// ==========================================
wss.on('connection', (ws) => {
    let userId = null;

    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw);

            // ① 유저 접속 및 초기화
            if (data.type === 'INIT') {
                userId = data.nickname;
                if (!USERS[userId]) {
                    const defaultStats = calculateStats(4, 5); // 파이리 Lv.5 시작
                    USERS[userId] = {
                        nickname: userId,
                        gold: 10000,
                        balls: { poke: 5, super: 0, hyper: 0, master: 0 },
                        inventory: { '불꽃의 돌': 0, '물의 돌': 0, '리프의 돌': 0, '천둥의 돌': 0, '던전 입장권': 0 },
                        dungeonTicketFree: 2,
                        partner: {
                            id: 4,
                            name: '파이리',
                            level: 5,
                            exp: 0,
                            maxExp: 100,
                            hp: defaultStats.maxHp,
                            maxHp: defaultStats.maxHp,
                            fatigue: 0,
                            affinity: 10.0, // 친밀도 %
                            isShiny: false,
                            stats: defaultStats
                        },
                        location: '마을',
                        activeWild: null
                    };
                }
                ws.send(JSON.stringify({ type: 'STATE_UPDATE', user: USERS[userId] }));
                broadcastUserList();
            }

            // ② 필드 탐험 (드랍률 및 이로치 확률 정밀 처리)
            if (data.type === 'EXPLORE_FIELD') {
                const user = USERS[userId];
                user.location = '필드';

                const wildPool = [1, 4, 7, 25];
                const wildId = wildPool[Math.floor(Math.random() * wildPool.length)];
                
                // 1/4096 이로치(Shiny) 등장 여부
                const isShiny = Math.random() < (1 / 4096);
                const wildLevel = Math.max(1, user.partner.level + Math.floor(Math.random() * 5) - 2);
                const wildStats = calculateStats(wildId, wildLevel);

                // 야생 포켓몬 객체 생성
                user.activeWild = {
                    id: wildId,
                    name: POKEMON_DB[wildId].name,
                    level: wildLevel,
                    hp: wildStats.maxHp, // 야생 초기 HP 100%
                    maxHp: wildStats.maxHp,
                    baseCatchRate: POKEMON_DB[wildId].baseCatchRate,
                    isShiny: isShiny,
                    stats: wildStats
                };

                // 드랍 테이블 판정
                let dropMsg = '';
                const rand = Math.random();
                if (rand < 0.05) { // 5% 몬스터볼
                    user.balls.poke += 1;
                    dropMsg = ' [아이템 획득: 몬스터볼 +1]';
                } else if (rand < 0.08) { // 3% 던전 입장권
                    user.inventory['던전 입장권'] += 1;
                    dropMsg = ' [아이템 획득: 던전 입장권 +1]';
                }

                ws.send(JSON.stringify({
                    type: 'WILD_SPAWN',
                    wild: user.activeWild,
                    user: user,
                    msg: `야생의 ${isShiny ? '✨이로치 ' : ''}${user.activeWild.name}이(가) 나타났다!` + dropMsg
                }));
                broadcastUserList();
            }

            // ③ 야생 포켓몬 공격 (포획률 높이기 위해 HP 깎기)
            if (data.type === 'ATTACK_WILD') {
                const user = USERS[userId];
                if (!user.activeWild) return;

                // 약한 공격으로 HP 깎기
                const damage = Math.floor(user.activeWild.maxHp * 0.35); 
                user.activeWild.hp = Math.max(1, user.activeWild.hp - damage); // 최소 1 남김

                ws.send(JSON.stringify({
                    type: 'WILD_HP_UPDATE',
                    wildHp: user.activeWild.hp,
                    wildMaxHp: user.activeWild.maxHp,
                    msg: `${user.partner.name}의 공격! 야생 ${user.activeWild.name}의 체력이 줄었다!`
                }));
            }

            // ④ 원작 공식 기반 포획 시도
            if (data.type === 'CATCH_ATTEMPT') {
                const user = USERS[userId];
                const ballType = data.ballType;

                if (!user.activeWild) return;
                if (user.balls[ballType] <= 0) {
                    ws.send(JSON.stringify({ type: 'CATCH_FAIL', msg: '선택한 포켓볼이 부족합니다!' }));
                    return;
                }

                // 포켓볼 차감
                user.balls[ballType] -= 1;

                // 파트너 전투력
                const partnerPower = calculatePower(user.partner.stats, user.partner.level);
                
                // 확률 산출
                const catchChance = calculateCatchProbability(ballType, user.activeWild, partnerPower);
                const roll = Math.random() * 100;
                const isCaught = roll < catchChance;

                if (isCaught) {
                    // 이로치 유전자 전이 및 파트너 교체 옵션 처리
                    const caught = user.activeWild;
                    
                    // 신규 포켓몬이 이로치인 경우 유전자 전이 로직
                    if (caught.isShiny && !user.partner.isShiny) {
                        user.partner.isShiny = true;
                        user.partner.affinity = 0.0; // 유전자 전이 시 친밀도 0% 리셋
                    } else {
                        // 친밀도 상승
                        user.partner.affinity = Math.min(100, user.partner.affinity + 0.5);
                    }

                    user.activeWild = null;
                    user.location = '마을';

                    ws.send(JSON.stringify({
                        type: 'CATCH_SUCCESS',
                        caughtMon: caught,
                        user: user,
                        msg: `🎉 신난다! ${caught.name}을(를) 잡았다! (포획 확률: ${catchChance.toFixed(1)}%)`
                    }));
                } else {
                    // 1~3회 흔들림 연출 계산
                    const shakes = Math.floor((roll / 100) * 3);
                    ws.send(JSON.stringify({
                        type: 'CATCH_BREAK',
                        shakes: shakes,
                        user: user,
                        msg: `아깝다! 볼이 ${shakes}번 흔들리고 포켓몬이 빠져나왔다! (확률: ${catchChance.toFixed(1)}%)`
                    }));
                }
            }

            // ⑤ 훈련소 (지수 비용 및 피로도 적용)
            if (data.type === 'TRAIN') {
                const user = USERS[userId];
                const cost = getTrainingCost(user.partner.level);

                if (user.partner.fatigue >= 100) {
                    ws.send(JSON.stringify({ type: 'TRAIN_FAIL', msg: '포켓몬이 너무 지쳤습니다! 포켓몬 센터에서 치료하세요.' }));
                    return;
                }

                if (user.gold >= cost) {
                    user.gold -= cost;
                    user.partner.exp += 35;
                    user.partner.fatigue = Math.min(100, user.partner.fatigue + 15);
                    user.partner.affinity = Math.min(100, user.partner.affinity + 0.2);

                    // 레벨업 검사
                    if (user.partner.exp >= user.partner.maxExp) {
                        user.partner.level += 1;
                        user.partner.exp -= user.partner.maxExp;
                        user.partner.maxExp = Math.floor(user.partner.maxExp * 1.25);
                        user.partner.stats = calculateStats(user.partner.id, user.partner.level);
                        user.partner.hp = user.partner.stats.maxHp;
                    }

                    ws.send(JSON.stringify({ type: 'STATE_UPDATE', user: user, msg: `훈련 완료! (비용: ${cost.toLocaleString()}G)` }));
                } else {
                    ws.send(JSON.stringify({ type: 'TRAIN_FAIL', msg: `골드가 부족합니다. (필요: ${cost.toLocaleString()}G)` }));
                }
            }

            // ⑥ 포켓몬 센터 (치료 및 피로도 회복)
            if (data.type === 'HEAL') {
                const user = USERS[userId];
                user.partner.hp = user.partner.stats.maxHp;
                user.partner.fatigue = 0;
                ws.send(JSON.stringify({ type: 'STATE_UPDATE', user: user, msg: '🏥 간호순: 포켓몬이 모두 건강해졌습니다!' }));
            }

            // ⑦ 진화 시스템 (친밀도 30% 감소 알고리즘)
            if (data.type === 'EVOLVE') {
                const user = USERS[userId];
                const pInfo = POKEMON_DB[user.partner.id];

                if (!pInfo.nextEvo) {
                    ws.send(JSON.stringify({ type: 'EVOLVE_FAIL', msg: '이미 최종 진화 단계입니다!' }));
                    return;
                }

                const stoneNeeded = pInfo.reqStone;
                if (user.inventory[stoneNeeded] <= 0) {
                    ws.send(JSON.stringify({ type: 'EVOLVE_FAIL', msg: `진화에 [${stoneNeeded}]이(가) 필요합니다!` }));
                    return;
                }

                // 진화 수행
                user.inventory[stoneNeeded] -= 1;
                user.partner.id = pInfo.nextEvo;
                user.partner.name = POKEMON_DB[pInfo.nextEvo].name;
                
                // 친밀도 30% 감소
                user.partner.affinity = Math.max(0, user.partner.affinity * 0.7);
                
                // 스탯 재계산
                user.partner.stats = calculateStats(user.partner.id, user.partner.level);
                user.partner.hp = user.partner.stats.maxHp;

                ws.send(JSON.stringify({ type: 'STATE_UPDATE', user: user, msg: `✨ 축하합니다! 포켓몬이 [${user.partner.name}](으)로 진화했습니다!` }));
            }

        } catch (err) {
            console.error("데이터 처리 오류:", err);
        }
    });

    function broadcastUserList() {
        const list = Object.values(USERS).map(u => ({
            nickname: u.nickname,
            location: u.location,
            power: calculatePower(u.partner.stats, u.partner.level)
        }));
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'SIDEBAR_LIST', users: list }));
            }
        });
    }
});

server.listen(3000, () => {
    console.log('🎮 정밀 알고리즘 탑재 포켓몬 엔진 구동 중: http://localhost:3000');
});
