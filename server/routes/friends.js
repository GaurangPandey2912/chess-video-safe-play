const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const FriendRequest = require('../models/FriendRequest');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const onlineUsers = req.app.get('onlineUsers') || new Map();

    const accepted = await FriendRequest.find({
      $or: [{ from: req.user._id }, { to: req.user._id }],
      status: 'accepted',
    }).populate('from to', 'username peerId');

    const friends = accepted.map(fr => {
      const friend = fr.from._id.equals(req.user._id) ? fr.to : fr.from;
      return {
        _id: friend._id,
        username: friend.username,
        peerId: friend.peerId || ('cv-' + friend.username),
        online: onlineUsers.has(friend._id.toString()),
      };
    });

    res.json({ friends });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/requests', auth, async (req, res) => {
  try {
    const incoming = await FriendRequest.find({ to: req.user._id, status: 'pending' })
      .populate('from', 'username');
    const outgoing = await FriendRequest.find({ from: req.user._id, status: 'pending' })
      .populate('to', 'username');
    res.json({ incoming, outgoing });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/request/:userId', auth, async (req, res) => {
  try {
    const target = await User.findById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target._id.equals(req.user._id)) return res.status(400).json({ error: 'Cannot add yourself' });

    const existing = await FriendRequest.findOne({
      $or: [
        { from: req.user._id, to: target._id },
        { from: target._id, to: req.user._id },
      ],
    });

    if (existing) {
      if (existing.status === 'accepted') return res.status(400).json({ error: 'Already friends' });
      if (existing.status === 'pending') return res.status(400).json({ error: 'Request already sent' });
      existing.status = 'pending';
      await existing.save();
      return res.json({ message: 'Friend request sent' });
    }

    await new FriendRequest({ from: req.user._id, to: target._id }).save();
    res.status(201).json({ message: 'Friend request sent' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:requestId/accept', auth, async (req, res) => {
  try {
    const request = await FriendRequest.findById(req.params.requestId);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (!request.to.equals(req.user._id)) return res.status(403).json({ error: 'Not authorized' });
    if (request.status !== 'pending') return res.status(400).json({ error: 'Already handled' });

    request.status = 'accepted';
    await request.save();
    res.json({ message: 'Friend request accepted' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:requestId/reject', auth, async (req, res) => {
  try {
    const request = await FriendRequest.findById(req.params.requestId);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (!request.to.equals(req.user._id)) return res.status(403).json({ error: 'Not authorized' });
    if (request.status !== 'pending') return res.status(400).json({ error: 'Already handled' });

    request.status = 'rejected';
    await request.save();
    res.json({ message: 'Friend request rejected' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:friendId', auth, async (req, res) => {
  try {
    const friendship = await FriendRequest.findOne({
      $or: [
        { from: req.user._id, to: req.params.friendId },
        { from: req.params.friendId, to: req.user._id },
      ],
      status: 'accepted',
    });
    if (!friendship) return res.status(404).json({ error: 'Friendship not found' });

    friendship.status = 'rejected';
    await friendship.save();
    res.json({ message: 'Friend removed' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/search', auth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 1) return res.json({ users: [] });

    const users = await User.find({
      username: { $regex: q, $options: 'i' },
      _id: { $ne: req.user._id },
    }).limit(20).select('username');

    res.json({ users });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
