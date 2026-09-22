const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// --- 관리자 비밀번호 설정 ---
const ADMIN_PASSWORD = "admin";

// --- 초기 부서별 주가 데이터 ---
const STOCKS = {
  1: { name: '경영관리부', price: 5000, startPrice: 5000, category: '소형주' },
  2: { name: '영업부', price: 6000, startPrice: 6000, category: '중형주' },
  3: { name: '도로부', price: 17000, startPrice: 17000, category: '대형주' },
  4: { name: '구조부', price: 9000, startPrice: 9000, category: '중형주' },
  5: { name: '지반부', price: 14000, startPrice: 14000, category: '대형주' },
  6: { name: '교통계획부', price: 11000, startPrice: 11000, category: '대형주' },
  7: { name: '도시개발부', price: 9000, startPrice: 9000, category: '중형주' },
  8: { name: '단지설계부', price: 8000, startPrice: 8000, category: '중형주' },
  9: { name: '조경부', price: 9000, startPrice: 9000, category: '중형주' },
  10: { name: '환경부', price: 9000, startPrice: 9000, category: '중형주' },
  11: { name: '안전진단부', price: 12000, startPrice: 12000, category: '대형주' },
  12: { name: '수자원부', price: 10000, startPrice: 10000, category: '중형주' },
  13: { name: '상하수도부', price: 8000, startPrice: 8000, category: '중형주' },
  14: { name: '건설사업관리부', price: 4000, startPrice: 4000, category: '소형주' }
};

let tradeVolume = {};
Object.keys(STOCKS).forEach(id => tradeVolume[id] = 0);

// IP 기반 유저 데이터 저장소
let userDbByIp = {}; 

let latestNews = "사내 모의 주식 거래 시스템에 오신 것을 환영합니다.";
let newsHistory = [];

const HUMOR_NEWS = [
  { deptId: 1, type: 'good', rate: 0.18, msg: "경영관리부, 탕비실 고급 간식 대량 입고 결정! 직원 사기 충천" },
  { deptId: 1, type: 'bad', rate: -0.15, msg: "경영관리부, 실수로 전사 메일에 법인카드 결제 내역 첨부" },
  { deptId: 3, type: 'good', rate: 0.15, msg: "도로부, 회식 자리에서 이사님이 고기 굽기 전담 선언!" },
  { deptId: 3, type: 'bad', rate: -0.12, msg: "도로부 본부장, 출장 복귀길에 렌터카 긁음" },
  { deptId: 5, type: 'good', rate: 0.17, msg: "지반부, 현장 조사 중 정체불명의 조선시대 엽전 발견!" },
  { deptId: 5, type: 'bad', rate: -0.14, msg: "지반부 막내, 중요 지반 데이터를 파쇄기에 넣음" },
  { deptId: 8, type: 'bad', rate: -0.19, msg: "단지설계부, 캐드(CAD) 파일 저장 안 하고 퇴근했다가 정전 발생" },
  { deptId: 11, type: 'good', rate: 0.12, msg: "안전진단부, 진단 장비에 커피 쏟았는데 분석 속도 2배 상승" },
  { deptId: 12, type: 'good', rate: 0.10, msg: "수자원부, 탕비실 정수기 얼음 잘 나온다고 사내 만족도 1위 달성" },
  { deptId: 14, type: 'bad', rate: -0.13, msg: "건설사업관리부, 안전모 안 쓰고 현장 서성이다 자체 단속 적발" }
];

io.on('connection', (socket) => {
  let rawIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  let clientIp = rawIp.replace('::ffff:', '').replace('::1', '127.0.0.1');

  socket.emit('checkExistingUser', { 
    existingUser: userDbByIp[clientIp] ? { name: userDbByIp[clientIp].name, isAdmin: userDbByIp[clientIp].isAdmin } : null 
  });

  socket.on('login', ({ name, adminPassword }) => {
    let isAdmin = false;

    if (adminPassword) {
      if (adminPassword === ADMIN_PASSWORD) {
        isAdmin = true;
      } else {
        return socket.emit('alert', '관리자 비밀번호가 올바르지 않습니다.');
      }
    }

    if (!userDbByIp[clientIp]) {
      userDbByIp[clientIp] = {
        ip: clientIp,
        name: name || `사원_${clientIp.split('.').pop()}`,
        cash: 1000000,
        stocks: {},
        isAdmin: isAdmin,
        online: true,
        socketId: socket.id
      };
      Object.keys(STOCKS).forEach(id => userDbByIp[clientIp].stocks[id] = 0);
    } else {
      if (name) userDbByIp[clientIp].name = name;
      if (isAdmin) userDbByIp[clientIp].isAdmin = true;
      userDbByIp[clientIp].online = true;
      userDbByIp[clientIp].socketId = socket.id;
    }

    const userData = userDbByIp[clientIp];
    socket.emit('loginSuccess', { user: userData, stocks: STOCKS, news: latestNews, newsHistory });
    broadcastUserState();
  });

  socket.on('changeNickname', (newName) => {
    if (userDbByIp[clientIp] && newName.trim()) {
      userDbByIp[clientIp].name = newName.trim();
      socket.emit('updateUserData', userDbByIp[clientIp]);
      broadcastUserState();
      socket.emit('alert', '닉네임이 변경되었습니다.');
    }
  });

  socket.on('buy', ({ deptId, count }) => {
    const user = userDbByIp[clientIp];
    const stock = STOCKS[deptId];
    if (!user || !stock) return;

    const totalCost = stock.price * count;
    if (user.cash >= totalCost) {
      user.cash -= totalCost;
      user.stocks[deptId] = (user.stocks[deptId] || 0) + count;
      tradeVolume[deptId] += count;

      socket.emit('updateUserData', user);
      broadcastUserState();
    } else {
      socket.emit('alert', '잔액이 부족합니다.');
    }
  });

  socket.on('sell', ({ deptId, count }) => {
    const user = userDbByIp[clientIp];
    const stock = STOCKS[deptId];
    if (!user || !stock) return;

    if ((user.stocks[deptId] || 0) >= count) {
      user.cash += stock.price * count;
      user.stocks[deptId] -= count;
      tradeVolume[deptId] -= count;

      socket.emit('updateUserData', user);
      broadcastUserState();
    } else {
      socket.emit('alert', '보유 주식 수가 부족합니다.');
    }
  });

  socket.on('adminModifyUser', ({ targetIp, cash }) => {
    if (!userDbByIp[clientIp]?.isAdmin) return;
    if (userDbByIp[targetIp]) {
      if (cash !== undefined) userDbByIp[targetIp].cash = Number(cash);

      if (userDbByIp[targetIp].socketId) {
        io.to(userDbByIp[targetIp].socketId).emit('updateUserData', userDbByIp[targetIp]);
      }
      broadcastUserState();
    }
  });

  socket.on('disconnect', () => {
    if (userDbByIp[clientIp]) {
      userDbByIp[clientIp].online = false;
      userDbByIp[clientIp].socketId = null;
    }
    broadcastUserState();
  });
});

function broadcastUserState() {
  const userList = Object.values(userDbByIp).map(u => ({
    ip: u.ip,
    name: u.name,
    cash: u.cash,
    stocks: u.stocks,
    online: u.online,
    totalAssets: u.cash + Object.keys(STOCKS).reduce((sum, id) => sum + (u.stocks[id] || 0) * STOCKS[id].price, 0)
  }));
  io.emit('userListUpdate', userList);
}

// 주가 변동 알고리즘 (1분 주기)
setInterval(() => {
  Object.keys(STOCKS).forEach(id => {
    const stock = STOCKS[id];
    const netTrade = tradeVolume[id] || 0;
    const rTrade = (netTrade / 1000) * 0.05;

    let maxRange = 0.035;
    if (stock.category === '대형주') maxRange = 0.02;
    if (stock.category === '소형주') maxRange = 0.05;

    const rRandom = (Math.random() * (maxRange * 2)) - maxRange;

    let newPrice = stock.price * (1 + rTrade + rRandom);
    newPrice = Math.max(100, Math.round(newPrice / 100) * 100);

    stock.price = newPrice;
    tradeVolume[id] = 0;
  });

  io.emit('stockUpdate', STOCKS);
}, 1 * 60 * 1000); // 1분

// 뉴스 속보 이벤트 (10분 주기)
setInterval(() => {
  if (Math.random() < 0.7) { // 70% 확률로 뉴스 발생
    const newsItem = HUMOR_NEWS[Math.floor(Math.random() * HUMOR_NEWS.length)];
    const stock = STOCKS[newsItem.deptId];

    let newPrice = stock.price * (1 + newsItem.rate);
    stock.price = Math.max(100, Math.round(newPrice / 100) * 100);

    const timeStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const newsObj = {
      time: timeStr,
      deptName: stock.name,
      rate: newsItem.rate,
      msg: newsItem.msg,
      text: `[${timeStr}] ${newsItem.msg} (${newsItem.rate > 0 ? '+' : ''}${(newsItem.rate * 100).toFixed(1)}%)`
    };
    
    latestNews = newsObj.text;
    newsHistory.unshift(newsObj);

    io.emit('newsUpdate', { news: latestNews, stocks: STOCKS, newsHistory });
  }
}, 10 * 60 * 1000); // 10분

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`================================================`);
  console.log(`[IP 저장형 사내 주식 시스템 구동 성공]`);
  console.log(`관리자 기본 비밀번호: admin`);
  console.log(`서버 PC 접속 주소: http://localhost:${PORT}`);
  console.log(`================================================`);
});