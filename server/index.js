require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const authRoutes = require('./routes/auth');
const friendRoutes = require('./routes/friends');
const User = require('./models/User');
const FriendRequest = require('./models/FriendRequest');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/friends', friendRoutes);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const onlineUsers = new Map();
app.set('onlineUsers', onlineUsers);

const wss = new WebSocketServer({ server });

function broadcast(userIds, message) {
  for (const id of userIds) {
    const entry = onlineUsers.get(id);
    if (entry) entry.ws.send(JSON.stringify(message));
  }
}

wss.on('connection', (ws) => {
  let userId = null;
  let userData = null;

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'auth') {
        try {
          const decoded = jwt.verify(msg.token, process.env.JWT_SECRET);
          const user = await User.findById(decoded.userId);
          if (!user) return ws.send(JSON.stringify({ type: 'error', message: 'User not found' }));

          userId = user._id.toString();
          userData = user;

          if (msg.peerId) {
            user.peerId = msg.peerId;
            await user.save();
          }

          const peerId = msg.peerId || user.peerId || user.username;
          onlineUsers.set(userId, { ws, user });

          const friendships = await FriendRequest.find({
            $or: [{ from: userId }, { to: userId }],
            status: 'accepted',
          });

          const friendIds = friendships.map(fr =>
            fr.from.toString() === userId ? fr.to.toString() : fr.from.toString()
          );

          const friendIdsOnline = friendIds.filter(id => onlineUsers.has(id));
          broadcast(friendIdsOnline, {
            type: 'friend-online',
            userId,
            username: user.username,
            peerId,
          });

          const friendDocs = await User.find({ _id: { $in: friendIds } }).select('username peerId');
          const friendsWithStatus = friendDocs.map(f => ({
            _id: f._id,
            username: f.username,
            peerId: f.peerId || ('cv-' + f.username),
            online: onlineUsers.has(f._id.toString()),
          }));

          ws.send(JSON.stringify({ type: 'auth-success', userId }));
          ws.send(JSON.stringify({ type: 'friends-list', friends: friendsWithStatus }));
        } catch {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
        }
        return;
      }

      switch (msg.type) {
        case 'call-user': {
          const target = onlineUsers.get(msg.to);
          if (target) {
            target.ws.send(JSON.stringify({
              type: 'incoming-call',
              from: { userId, username: userData.username },
              peerId: msg.peerId,
            }));
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'User offline' }));
          }
          break;
        }
        case 'call-accepted': {
          const target = onlineUsers.get(msg.to);
          if (target) {
            target.ws.send(JSON.stringify({ type: 'call-accepted', peerId: msg.peerId }));
          }
          break;
        }
        case 'call-rejected': {
          const target = onlineUsers.get(msg.to);
          if (target) {
            target.ws.send(JSON.stringify({ type: 'call-rejected' }));
          }
          break;
        }
      }
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
    }
  });

  ws.on('close', async () => {
    if (userId) {
      onlineUsers.delete(userId);

      const friendships = await FriendRequest.find({
        $or: [{ from: userId }, { to: userId }],
        status: 'accepted',
      });

      const friendIds = friendships.map(fr =>
        fr.from.toString() === userId ? fr.to.toString() : fr.from.toString()
      );

      broadcast(friendIds, { type: 'friend-offline', userId });
    }
  });
});

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chess-video';

mongoose.connect(MONGODB_URI).then(() => {
  console.log('MongoDB connected');
  server.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
}).catch(err => {
  console.error('MongoDB connection error:', err.message);
  process.exit(1);
});
