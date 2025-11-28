#!/usr/bin/env node
'use strict';

require('dotenv').config();

const port = (() => {
  const args = process.argv;
  if (args.length !== 3) {
    console.error('usage: node index.js port');
    process.exit(1);
  }
  const num = parseInt(args[2], 10);
  if (isNaN(num)) {
    console.error('error: argument must be an integer.');
    process.exit(1);
  }
  return num;
})();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { expressjwt: jwtMiddleware } = require('express-jwt');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');

// Create Prisma client and Express app
const prisma = new PrismaClient();
const app = express();

// Core middleware
app.use(cors());
app.use(express.json());

// Auth/role helpers and utilities
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const ROLES = ['regular', 'cashier', 'manager', 'superuser'];
const ORDER = { regular: 0, cashier: 1, manager: 2, superuser: 3 };

const AVATAR_DIR = path.join(process.cwd(), 'uploads', 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });
app.use('/uploads/avatars', express.static(AVATAR_DIR));
const upload = multer({ dest: AVATAR_DIR });

const auth = jwtMiddleware({ secret: JWT_SECRET, algorithms: ['HS256'], requestProperty: 'auth' });

const roleOrder = (r) => ORDER[String(r || '').toLowerCase()] ?? -1;
const needRole = (min) => (req, res, next) => {
  if (!req.auth) return res.status(401).json({ error: 'Unauthorized' });
  if (roleOrder(req.auth.role) < roleOrder(min)) return res.status(403).json({ error: 'Forbidden' });
  next();
};
const isManagerOrHigher = (r) => roleOrder(r) >= roleOrder('manager');
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,20}$/;
const utoridRegex = /^[a-z0-9]{7,8}$/i;
const uoftEmail = (s) => {
  if (typeof s !== 'string') return false;
  const email = s.trim().toLowerCase();
  return email.endsWith('@mail.utoronto.ca');
};
const now = () => new Date();
const basePoints = (spent) => Math.round(Number(spent) / 0.25);
const lastResetByIp = new Map();
const isActivePromo = (p) => p.startTime <= now() && p.endTime >= now();
async function pickAvailableOneTimePromos(userId) {
  const promos = await prisma.promotion.findMany({});
  const active = promos.filter(isActivePromo).filter(p => p.type === 'onetime');
  const used = await prisma.userPromotionUsage.findMany({
    where: { userId, usedAt: { not: null } }, select: { promotionId: true }
  });
  const usedSet = new Set(used.map(x => x.promotionId));
  return active.filter(p => !usedSet.has(p.id)).map(p => ({
    id: p.id, name: p.name, startTime: p.startTime, endTime: p.endTime,
    minSpending: p.minSpending, rate: p.rate, points: p.points
  }));
}

// Auth: login returns JWT
app.post('/auth/tokens', async (req, res) => {
  try {
    const { utorid, password } = req.body || {};
    if (!utorid || !password) return res.status(400).json({ error: 'Bad Request' });
    const user = await prisma.user.findUnique({ where: { utorid } });
    if (!user || !user.passwordHash) return res.status(401).json({ error: 'Unauthorized' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Unauthorized' });
    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: now() } });
    const token = jwt.sign({ id: user.id, utorid: user.utorid, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, expiresAt: new Date(Date.now() + 3600e3).toISOString() });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// Auth: request a password reset token
app.post('/auth/resets', async (req, res) => {
  try {
    const { utorid } = req.body || {};
    if (!utorid) return res.status(400).json({ error: 'Bad Request' });

    const u = await prisma.user.findUnique({ where: { utorid } });
    if (!u) return res.status(404).json({ error: 'Not Found' });
    await prisma.resetToken.deleteMany({ where: { userId: u.id } });

    const resetToken = uuidv4();
    const expiresAt = new Date(Date.now() + 3600e3);

    await prisma.resetToken.create({ data: { id: resetToken, userId: u.id, expiresAt, consumed: false } });

    return res.status(202).json({
      expiresAt: expiresAt.toISOString(),
      resetToken
    });
  } catch {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Auth: complete password reset
app.post('/auth/resets/:resetToken', async (req, res) => {
  try {
    const t = await prisma.resetToken.findUnique({ where: { id: req.params.resetToken } });
    if (!t) return res.status(404).json({ error: 'Not Found' });
    if (t.consumed) {
      return res.status(404).json({ error: 'Not Found' });
    }
    const expMs = new Date(t.expiresAt).getTime();
    if (!Number.isFinite(expMs) || expMs <= Date.now()) {
      return res.status(410).json({ error: 'Gone' });
    }

    const u = await prisma.user.findUnique({ where: { id: t.userId } });
    if (!u) return res.status(404).json({ error: 'Not Found' });
    const { utorid, password } = req.body || {};
    if (!utorid || !password) return res.status(400).json({ error: 'Bad Request' });
    if (u.utorid !== utorid) return res.status(401).json({ error: 'Unauthorized' });
    if (!passwordRegex.test(password)) return res.status(400).json({ error: 'Bad Request' });
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.$transaction([
      prisma.user.update({ where: { id: u.id }, data: { passwordHash } }),
      prisma.resetToken.delete({ where: { id: t.id } })
    ]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Users: create a new user (cashier+)
app.post('/users', auth, needRole('cashier'), async (req, res) => {
  try {
    const { utorid, name, email } = req.body || {};
    if (!utorid || !name || !email) return res.status(400).json({ error: 'Bad Request' });
    if (!utoridRegex.test(utorid)) return res.status(400).json({ error: 'Bad Request' });
    if (name.length < 1 || name.length > 50) return res.status(400).json({ error: 'Bad Request' });
    if (!uoftEmail(email)) return res.status(400).json({ error: 'Bad Request' });

    if (await prisma.user.findUnique({ where: { utorid } })) {
      return res.status(409).json({ error: 'Conflict' });
    }

    const created = await prisma.user.create({
      data: { utorid, name, email, verified: false, role: 'regular' }
    });
    const resetToken = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600e3);
    await prisma.resetToken.create({ data: { id: resetToken, userId: created.id, expiresAt } });

    res.status(201).json({
      id: created.id,
      utorid: created.utorid,
      name: created.name,
      email: created.email,
      verified: false,
      expiresAt: expiresAt.toISOString(),
      resetToken
    });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// Users: list users (manager+)
app.get('/users', auth, needRole('manager'), async (req, res) => {
  try {
    const posInt = (x) => Number.isInteger(Number(x)) && Number(x) > 0;
    const getParamCI = (obj, target) => {
      const key = Object.keys(obj).find(k => k.toLowerCase() === target.toLowerCase());
      return key ? obj[key] : undefined;
    };
    const parseBool = (v) => {
      if (typeof v === 'boolean') return v;
      if (v == null) return null;
      const s = String(v).trim().toLowerCase();
      if (['true','1','t','yes','y'].includes(s)) return true;
      if (['false','0','f','no','n'].includes(s)) return false;
      return null;
    };
    const rawPage  = getParamCI(req.query, 'page')  ?? '1';
    const rawLimit = getParamCI(req.query, 'limit') ?? '10';
    if (!posInt(rawPage) || !posInt(rawLimit)) return res.status(400).json({ error: 'Bad Request' });
    const pageNum  = Number(rawPage);
    const limitNum = Number(rawLimit);
    const where = {};

    const rawName = getParamCI(req.query, 'name');
    if (typeof rawName !== 'undefined' && String(rawName).length > 0) {
      where.OR = [
        { utorid: { contains: String(rawName) } },
        { name:   { contains: String(rawName) } }
      ];
    }
    const rawRole = getParamCI(req.query, 'role');
    if (rawRole && ROLES.includes(String(rawRole).toLowerCase())) {
      where.role = String(rawRole).toLowerCase();
    }
    const rawVerified  = getParamCI(req.query, 'verified');
    const parsedVerified = parseBool(rawVerified);
    if (parsedVerified !== null) where.verified = parsedVerified;
    const rawActivated = getParamCI(req.query, 'activated');
    const parsedActivated = parseBool(rawActivated);
    if (parsedActivated !== null) {
      where.lastLogin = parsedActivated ? { not: null } : { equals: null };
    }

    const skip = (pageNum - 1) * limitNum;
    const take = limitNum;
    const [count, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where, skip, take, orderBy: { id: 'asc' },
        select: {
          id: true, utorid: true, name: true, email: true, birthday: true, role: true,
          points: true, createdAt: true, lastLogin: true, verified: true, avatarUrl: true
        }
      })
    ]);
    res.json({ count, results: rows });
  } catch {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Users: fetch current user's profile
app.get('/users/me', auth, async (req, res) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.auth.id } });
    if (!me) return res.status(404).json({ error: 'Not Found' });
    let promotions = [];
    try {
      promotions = await pickAvailableOneTimePromos(me.id);
    } catch { promotions = []; }

    return res.json({
      id: me.id,
      utorid: me.utorid,
      name: me.name,
      email: me.email,
      birthday: me.birthday,
      role: me.role,
      points: me.points,
      createdAt: me.createdAt,
      lastLogin: me.lastLogin,
      verified: me.verified,
      avatarUrl: me.avatarUrl,
      promotions
    });
  } catch {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Users: update current user's profile and avatar
app.patch('/users/me', auth, upload.single('avatar'), async (req, res) => {
  try {
    const body = req.body || {};
    const data = {};

    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
      const raw = body.name;

      if (raw !== null && raw !== undefined) {
        const name = String(raw);

        if (name.length < 1 || name.length > 50) {
          return res.status(400).json({ error: 'Bad Request' });
        }
        data.name = name;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'email')) {
      const raw = body.email;

      if (raw !== null && raw !== undefined) {
        const email = String(raw);
        if (!uoftEmail(email)) {
          return res.status(400).json({ error: 'Bad Request' });
        }
        data.email = email;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'birthday')) {
      const raw = body.birthday;

      if (raw !== null && raw !== undefined) {
        const b = String(raw);

        if (!/^\d{4}-\d{2}-\d{2}$/.test(b)) {
          return res.status(400).json({ error: 'Bad Request' });
        }

        const [Y, M, D] = b.split('-').map(Number);

        const d = new Date(Y, M - 1, D);

        if (d.getFullYear() !== Y || d.getMonth() !== M - 1 || d.getDate() !== D) {
          return res.status(400).json({ error: 'Bad Request' });
        }
        data.birthday = b;
      }
    }

    if (req.file) {
      try {
        const ext = (path.extname(req.file.originalname || '') || '.png').toLowerCase();
        const dest = path.join(AVATAR_DIR, `${req.auth.utorid}${ext}`);
        fs.renameSync(req.file.path, dest);
        data.avatarUrl = `/uploads/avatars/${path.basename(dest)}`;
      } catch {
        return res.status(400).json({ error: 'Bad Request' });
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const me = await prisma.user.update({
      where: { id: req.auth.id },
      data,
    });

    return res.json({
      id: me.id,
      utorid: me.utorid,
      name: me.name,
      email: me.email,
      birthday: me.birthday,
      role: me.role,
      points: me.points,
      createdAt: me.createdAt,
      lastLogin: me.lastLogin,
      verified: me.verified,
      avatarUrl: me.avatarUrl,
    });
  } catch (e) {
    if (e && e.code === 'P2002') {

      return res.status(400).json({ error: 'Bad Request' });
    }
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Users: get user by id (cashier+)
app.get('/users/:userId', auth, needRole('cashier'), async (req, res) => {
  try {
    const id = Number(req.params.userId);
    if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Not Found' });

    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) return res.status(404).json({ error: 'Not Found' });

    const promotions = await pickAvailableOneTimePromos(u.id);
    const managerView = isManagerOrHigher(req.auth.role);

    if (managerView) {
      return res.json({
        id: u.id, utorid: u.utorid, name: u.name, email: u.email, birthday: u.birthday,
        role: u.role, points: u.points, createdAt: u.createdAt, lastLogin: u.lastLogin,
        verified: u.verified, avatarUrl: u.avatarUrl, promotions
      });
    }
    return res.json({
      id: u.id, utorid: u.utorid, name: u.name, points: u.points, verified: u.verified, promotions
    });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// Users: manager updates user fields
app.patch('/users/:userId', auth, needRole('manager'), async (req, res) => {
  try {
    const id = Number(req.params.userId);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(404).json({ error: 'Not Found' });
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) {
      return res.status(404).json({ error: 'Not Found' });
    }

    const getCI = (obj, key) => {
      const k = Object.keys(obj || {}).find(
        (x) => x.toLowerCase() === key.toLowerCase()
      );
      return k ? obj[k] : undefined;
    };
    const inBody = (obj, key) =>
      Object.keys(obj || {}).some(
        (x) => x.toLowerCase() === key.toLowerCase()
      );

    const body = req.body || {};
    const data = {};
    const updatedKeys = [];

    if (inBody(body, 'role')) {
      const toRaw = getCI(body, 'role');

      if (toRaw !== null && toRaw !== undefined) {
        if (typeof toRaw !== 'string') {
          return res.status(400).json({ error: 'Bad Request' });
        }

        const to = toRaw.trim().toLowerCase();
        const ALLOWED = new Set(['regular', 'cashier', 'manager', 'superuser']);

        if (!ALLOWED.has(to)) {

          return res.status(400).json({ error: 'Bad Request' });
        }

        const amSuperuser =
          String(req.auth.role || '').toLowerCase() === 'superuser';

        if (!amSuperuser && !['regular', 'cashier'].includes(to)) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        if (to === 'cashier' && target.suspicious === true) {
          return res.status(400).json({ error: 'Bad Request' });
        }

        data.role = to;
        updatedKeys.push('role');
      }
    }

    if (inBody(body, 'email')) {
      const emailRaw = getCI(body, 'email');

      if (emailRaw !== null && emailRaw !== undefined) {
        if (typeof emailRaw !== 'string') {
          return res.status(400).json({ error: 'Bad Request' });
        }
        const email = emailRaw.trim();
        if (!uoftEmail(email)) {
          return res.status(400).json({ error: 'Bad Request' });
        }
        data.email = email;
        updatedKeys.push('email');
      }
    }

    if (inBody(body, 'verified')) {
      const vraw = getCI(body, 'verified');

      if (vraw !== null && vraw !== undefined) {

        if (typeof vraw !== 'boolean') {
          return res.status(400).json({ error: 'Bad Request' });
        }

        if (vraw === false) {
          return res.status(400).json({ error: 'Bad Request' });
        }

        data.verified = true;
        updatedKeys.push('verified');
      }
    }

    if (inBody(body, 'suspicious')) {
      const sraw = getCI(body, 'suspicious');

      if (sraw !== null && sraw !== undefined) {

        if (typeof sraw !== 'boolean') {
          return res.status(400).json({ error: 'Bad Request' });
        }

        data.suspicious = sraw;
        updatedKeys.push('suspicious');
      }
    }

    if (updatedKeys.length === 0) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const updated = await prisma.user.update({ where: { id }, data });
    const resp = {
      id: updated.id,
      utorid: updated.utorid,
      name: updated.name,
    };
    for (const k of updatedKeys) {
      resp[k] = updated[k];
    }
    return res.json(resp);
  } catch (e) {
    if (e && e.code === 'P2002') {
      return res.status(400).json({ error: 'Bad Request' });
    }
    if (e && e.code === 'P2025') {
      return res.status(404).json({ error: 'Not Found' });
    }
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Users: change password
app.patch('/users/me/password', auth, async (req, res) => {
  try {
    const { old, new: nw } = req.body || {};
    if (!old || !nw) return res.status(400).json({ error: 'Bad Request' });
    if (!passwordRegex.test(nw)) return res.status(400).json({ error: 'Bad Request' });
    const me = await prisma.user.findUnique({ where: { id: req.auth.id } });
    if (!me.passwordHash) return res.status(403).json({ error: 'Forbidden' });
    const ok = await bcrypt.compare(old, me.passwordHash);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
    await prisma.user.update({ where: { id: me.id }, data: { passwordHash: await bcrypt.hash(nw, 10) } });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

const normPromoTypeIn = (s) => {
  if (s === 'automatic') return 'automatic';
  if (s === 'one-time')  return 'onetime';
  return null;
};

const presentPromo = (p) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  type: p.type === 'onetime' ? 'one-time' : p.type,
  startTime: p.startTime,
  endTime: p.endTime,
  minSpending: p.minSpending,
  rate: p.rate,
  points: p.points,
});
const isPositiveInt = (x) => Number.isInteger(Number(x)) && Number(x) >= 0;
const isPositiveNum = (x) => Number.isFinite(Number(x)) && Number(x) > 0;

// Promotions: create
app.post('/promotions', auth, needRole('manager'), async (req, res) => {
  try {
    const { name, description, type, startTime, endTime, minSpending, rate, points } = req.body || {};
    if (!name || !description || !type || !startTime || !endTime) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const normType = normPromoTypeIn(type);
    if (!normType) return res.status(400).json({ error: 'Bad Request' });

    const st = new Date(startTime), et = new Date(endTime);
    if (!(st > now() && et > st)) return res.status(400).json({ error: 'Bad Request' });

    if (minSpending != null && !isPositiveNum(minSpending)) {
      return res.status(400).json({ error: 'Bad Request' });
    }
    if (rate != null && !isPositiveNum(rate)) {
      return res.status(400).json({ error: 'Bad Request' });
    }
    if (points != null && !isPositiveInt(points)) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const created = await prisma.promotion.create({
      data: {
        name,
        description,
        type: normType,
        startTime: st,
        endTime: et,
        minSpending: (minSpending == null ? null : Number(minSpending)),
        rate: (rate == null ? null : Number(rate)),
        points: (points == null ? null : Number(points))
      }
    });
    return res.status(201).json(presentPromo(created));
  } catch {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Promotions: list (role-aware view)
app.get('/promotions', auth, async (req, res) => {
  try {
    const page = req.query.page ?? '1';
    const limit = req.query.limit ?? '10';
    if (!isPositiveInt(page) || !isPositiveInt(limit)) {
      return res.status(400).json({ error: 'Bad Request' });
    }
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);
    const nowTime = now();

    const normOptStr = (v) => {
      if (v === undefined || v === null) return undefined;
      const s = String(v).trim();
      if (!s) return undefined;
      if (s.toLowerCase() === 'null') return undefined;
      return s;
    };

    if (ORDER[req.auth.role] === ORDER['regular'] || ORDER[req.auth.role] === ORDER['cashier']) {
      const nameQ = normOptStr(req.query.name);
      const typeQ = normOptStr(req.query.type);

      let typeNorm = null;
      if (typeQ !== undefined) {
        typeNorm = normPromoTypeIn(typeQ);
        if (!typeNorm) {
          return res.status(400).json({ error: 'Bad Request' });
        }
      }

      const where = {
        startTime: { lte: nowTime },
        endTime:   { gt:  nowTime }
      };

      if (nameQ !== undefined) {
        where.name = { contains: nameQ, mode: 'insensitive' };
      }

      if (typeNorm) {

        where.type = typeNorm;
      }

      const activeRows = await prisma.promotion.findMany({
        where,
        orderBy: { id: 'asc' }
      });

      const used = await prisma.userPromotionUsage.findMany({
        where: { userId: req.auth.id, usedAt: { not: null } },
        select: { promotionId: true }
      });
      const usedSet = new Set(used.map(x => x.promotionId));

      const usable = activeRows.filter(p => !usedSet.has(p.id));

      const pageRows = usable.slice(skip, skip + take);

      const results = pageRows.map(p => ({
        id: p.id,
        name: p.name,
        type: p.type === 'onetime' ? 'one-time' : p.type,
        endTime: p.endTime,
        minSpending: p.minSpending,
        rate: p.rate,
        points: p.points
      }));

      return res.json({ count: usable.length, results });
    }

    const nameQ = normOptStr(req.query.name);
    const typeQ = normOptStr(req.query.type);
    const { active, started, ended } = req.query;

    if (String(started) === 'true' && String(ended) === 'true') {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const where = {};

    if (nameQ !== undefined) {
      where.name = { contains: nameQ, mode: 'insensitive' };
    }
    if (typeQ !== undefined) {
      const typeNorm = normPromoTypeIn(typeQ);
      if (!typeNorm) {
        return res.status(400).json({ error: 'Bad Request' });
      }
      where.type = typeNorm;
    }

    if (String(active) === 'true') {

      where.startTime = { lte: nowTime };
      where.endTime   = { gt:  nowTime };
    } else if (String(started) === 'true') {

      where.startTime = { lte: nowTime };
    } else if (String(ended) === 'true') {

      where.endTime   = { lt: nowTime };
    }

    const [count, rows] = await Promise.all([
      prisma.promotion.count({ where }),
      prisma.promotion.findMany({
        where,
        skip,
        take,
        orderBy: { id: 'asc' }
      })
    ]);

    const results = rows.map(p => ({
      id: p.id,
      name: p.name,
      type: p.type === 'onetime' ? 'one-time' : p.type,
      startTime: p.startTime,
      endTime: p.endTime,
      minSpending: p.minSpending,
      rate: p.rate,
      points: p.points
    }));

    return res.json({ count, results });
  } catch (e) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Promotions: get by id
app.get('/promotions/:id', auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const p = await prisma.promotion.findUnique({ where: { id } });
    if (!p) return res.status(404).json({ error: 'Not Found' });

    const isMgr = ORDER[req.auth.role] >= ORDER['manager'];
    if (!isMgr && !isActivePromo(p)) return res.status(404).json({ error: 'Not Found' });

    return res.json(presentPromo(p));
  } catch {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Promotions: update with time/state rules
app.patch('/promotions/:id', auth, needRole('manager'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const p = await prisma.promotion.findUnique({ where: { id } });
    if (!p) return res.status(404).json({ error: 'Not Found' });

    const afterStart = p.startTime <= now();
    const afterEnd   = p.endTime   <  now();
    const body = req.body || {};
    const data = {};

    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
      const raw = body.name;
      if (raw !== null && raw !== undefined) {

        if (typeof raw !== 'string' || raw.trim() === '') {
          return res.status(400).json({ error: 'Bad Request' });
        }
        data.name = raw;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'description')) {
      const raw = body.description;

      if (raw !== null && raw !== undefined) {
        if (typeof raw !== 'string' || raw.trim() === '') {
          return res.status(400).json({ error: 'Bad Request' });
        }
        data.description = raw;
      }
    }

    if (afterEnd) {

    } else if (afterStart) {

      if (Object.prototype.hasOwnProperty.call(body, 'type') ||
          Object.prototype.hasOwnProperty.call(body, 'startTime')) {
        return res.status(400).json({ error: 'Bad Request' });
      }

      if (Object.prototype.hasOwnProperty.call(body, 'endTime')) {
        const et = new Date(body.endTime);
        if (!(et > now() && et > p.startTime)) {
          return res.status(400).json({ error: 'Bad Request' });
        }
        data.endTime = et;
      }

      if (Object.prototype.hasOwnProperty.call(body, 'minSpending')) {
        if (body.minSpending != null && !isPositiveNum(body.minSpending)) {
          return res.status(400).json({ error: 'Bad Request' });
        }
        data.minSpending = (body.minSpending == null ? null : Number(body.minSpending));
      }

      if (Object.prototype.hasOwnProperty.call(body, 'rate')) {
        if (body.rate != null && !isPositiveNum(body.rate)) {
          return res.status(400).json({ error: 'Bad Request' });
        }
        data.rate = (body.rate == null ? null : Number(body.rate));
      }

      if (Object.prototype.hasOwnProperty.call(body, 'points')) {
        if (body.points != null && !isPositiveInt(body.points)) {
          return res.status(400).json({ error: 'Bad Request' });
        }
        data.points = (body.points == null ? null : Number(body.points));
      }

    } else {

      if (Object.prototype.hasOwnProperty.call(body, 'type')) {
        const raw = body.type;

        if (raw !== null && raw !== undefined) {
          const t = normPromoTypeIn(raw);
          if (!t) {

            return res.status(400).json({ error: 'Bad Request' });
          }
          data.type = t;
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, 'startTime')) {
        const raw = body.startTime;
        if (raw !== null && raw !== undefined) {
          const st = new Date(raw);
          if (!(st > now())) {
            return res.status(400).json({ error: 'Bad Request' });
          }
          data.startTime = st;
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, 'endTime')) {
        const raw = body.endTime;
        if (raw !== null && raw !== undefined) {
          const et = new Date(raw);
          const stBase = data.startTime || p.startTime;

          if (!(et >= now() && et > stBase)) {
            return res.status(400).json({ error: 'Bad Request' });
          }
          data.endTime = et;
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, 'minSpending')) {
        if (body.minSpending != null && !isPositiveNum(body.minSpending)) {
          return res.status(400).json({ error: 'Bad Request' });
        }
        data.minSpending = (body.minSpending == null ? null : Number(body.minSpending));
      }

      if (Object.prototype.hasOwnProperty.call(body, 'rate')) {
        if (body.rate != null && !isPositiveNum(body.rate)) {
          return res.status(400).json({ error: 'Bad Request' });
        }
        data.rate = (body.rate == null ? null : Number(body.rate));
      }

      if (Object.prototype.hasOwnProperty.call(body, 'points')) {
        if (body.points != null && !isPositiveInt(body.points)) {
          return res.status(400).json({ error: 'Bad Request' });
        }
        data.points = (body.points == null ? null : Number(body.points));
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const updated = await prisma.promotion.update({ where: { id }, data });
    return res.json(presentPromo(updated));
  } catch (e) {
    if (e?.code === 'P2025') {
      return res.status(404).json({ error: 'Not Found' });
    }
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Promotions: delete if not started
app.delete('/promotions/:id', auth, needRole('manager'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const p = await prisma.promotion.findUnique({ where: { id } });
    if (!p) return res.status(404).json({ error: 'Not Found' });
    if (p.startTime <= now()) return res.status(403).json({ error: 'Forbidden' });
    await prisma.promotion.delete({ where: { id } });
    return res.status(204).end();
  } catch {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Events: create
app.post('/events', auth, needRole('manager'), async (req, res) => {
  try {
    const { name, description, location, startTime, endTime, capacity = null, points } = req.body || {};

    if (!name || !description || !location || !startTime || !endTime
        || typeof points !== 'number' || !Number.isInteger(points) || points <= 0) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const st = new Date(startTime);
    const et = new Date(endTime);
    if (!(et > st)) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    let cap = null;
    if (capacity !== null && typeof capacity !== 'undefined') {
      const capNum = Number(capacity);
      if (!Number.isFinite(capNum) || capNum <= 0) {
        return res.status(400).json({ error: 'Bad Request' });
      }
      cap = capNum;
    }

    const e = await prisma.event.create({
      data: {
        name,
        description,
        location,
        startTime: st,
        endTime: et,
        capacity: cap,
        published: false,
        pointsTotal: points,
        pointsRemain: points,
        pointsAwarded: 0
      }
    });

    return res.status(201).json({
      id: e.id,
      name: e.name,
      description: e.description,
      location: e.location,
      startTime: e.startTime,
      endTime: e.endTime,
      capacity: e.capacity,
      pointsRemain: e.pointsRemain,
      pointsAwarded: e.pointsAwarded,
      published: e.published,
      organizers: [],
      guests: []
    });
  } catch {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Events: list (role-aware, capacity filter)
app.get('/events', auth, async (req, res) => {
  try {

    const getCI = (obj, k) => {
      const key = Object.keys(obj || {}).find(x => x.toLowerCase() === k.toLowerCase());
      return key ? obj[key] : undefined;
    };
    const posInt = (x) => Number.isInteger(Number(x)) && Number(x) > 0;

    const name      = getCI(req.query, 'name');
    const location  = getCI(req.query, 'location');
    const started   = getCI(req.query, 'started');
    const ended     = getCI(req.query, 'ended');
    const showFull  = getCI(req.query, 'showFull');
    const published = getCI(req.query, 'published');
    const pageRaw   = getCI(req.query, 'page')  ?? '1';
    const limitRaw  = getCI(req.query, 'limit') ?? '10';

    if (!posInt(pageRaw) || !posInt(limitRaw)) {
      return res.status(400).json({ error: 'Bad Request' });
    }
    if (String(started) === 'true' && String(ended) === 'true') {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const isManager = (ORDER[req.auth.role] >= ORDER['manager']);
    const n = now();
    const where = {};
    if (name)     where.name     = { contains: String(name),     mode: 'insensitive' };
    if (location) where.location = { contains: String(location), mode: 'insensitive' };
    if (String(started) === 'true') where.startTime = { lte: n };
    if (String(ended)   === 'true') where.endTime   = { lt:  n };

    if (isManager) {
      if (typeof published !== 'undefined') where.published = String(published).toLowerCase() === 'true';
    } else {
      where.published = true;
    }

    const page  = Number(pageRaw);
    const limit = Number(limitRaw);
    const skip  = (page - 1) * limit;
    const take  = limit;

    const [ids] = await Promise.all([
      prisma.event.findMany({ where, orderBy: { id: 'asc' }, select: { id: true } })
    ]);

    const visibleIds = [];
    for (const row of ids) {
      const e = await prisma.event.findUnique({ where: { id: row.id }, select: { capacity: true } });
      let numGuests = 0;
      if (e) numGuests = await prisma.eventGuest.count({ where: { eventId: row.id } });
      const isFull = (e && e.capacity != null && numGuests >= e.capacity);
      const wantShowFull = String(showFull).toLowerCase() === 'true';
      if (!isFull || wantShowFull) visibleIds.push(row.id);
    }

    const count = visibleIds.length;
    const pageIds = visibleIds.slice(skip, skip + take);

    const rows = await prisma.event.findMany({
      where: { id: { in: pageIds } },
      orderBy: { id: 'asc' }
    });

    const results = [];
    for (const e of rows) {
      const numGuests = await prisma.eventGuest.count({ where: { eventId: e.id } });
      if (isManager) {

        results.push({
          id: e.id, name: e.name, location: e.location,
          startTime: e.startTime, endTime: e.endTime, capacity: e.capacity,
          pointsRemain: e.pointsRemain, pointsAwarded: e.pointsAwarded, published: e.published,
          numGuests
        });
      } else {

        results.push({
          id: e.id, name: e.name, location: e.location,
          startTime: e.startTime, endTime: e.endTime, capacity: e.capacity,
          numGuests
        });
      }
    }

    return res.json({ count, results });
  } catch {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Events: get details (role-aware)
app.get('/events/:id', auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(404).json({ error: 'Not Found' });
    }

    const e = await prisma.event.findUnique({ where: { id } });
    if (!e) return res.status(404).json({ error: 'Not Found' });

    const isManager   = ORDER[req.auth.role] >= ORDER['manager'];
    const isOrganizer = !!(await prisma.eventOrganizer.findUnique({
      where: { eventId_userId: { eventId: id, userId: req.auth.id } }
    }).catch(() => null));

    if (!e.published && !(isManager || isOrganizer)) {
      return res.status(404).json({ error: 'Not Found' });
    }

    const organizerRows = await prisma.eventOrganizer.findMany({
      where: { eventId: id },
      include: { user: { select: { id: true, utorid: true, name: true } } }
    });
    const organizers = organizerRows.map(o => ({
      id: o.user.id,
      utorid: o.user.utorid,
      name: o.user.name
    }));

    const guestRows = await prisma.eventGuest.findMany({
      where: { eventId: id },
      include: { user: { select: { id: true, utorid: true, name: true } } }
    });
    const numGuests = guestRows.length;

    if (isManager || isOrganizer) {
      const guests = guestRows.map(g => ({
        id: g.user.id,
        utorid: g.user.utorid,
        name: g.user.name

      }));

      return res.json({
        id: e.id,
        name: e.name,
        description: e.description,
        location: e.location,
        startTime: e.startTime,
        endTime: e.endTime,
        capacity: e.capacity,
        pointsRemain: e.pointsRemain,
        pointsAwarded: e.pointsAwarded,
        published: e.published,
        organizers,
        guests
      });
    }

    return res.json({
      id: e.id,
      name: e.name,
      description: e.description,
      location: e.location,
      startTime: e.startTime,
      endTime: e.endTime,
      capacity: e.capacity,
      organizers,
      numGuests
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Events: update (manager or organizer)
app.patch('/events/:id', auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(404).json({ error: 'Not Found' });
    }

    const e = await prisma.event.findUnique({ where: { id } });
    if (!e) return res.status(404).json({ error: 'Not Found' });

    const isManager   = ORDER[req.auth.role] >= ORDER['manager'];
    const isOrganizer = !!(await prisma.eventOrganizer.findUnique({
      where: { eventId_userId: { eventId: id, userId: req.auth.id } }
    }).catch(() => null));

    if (!isManager && !isOrganizer) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const afterStart = e.startTime <= now();
    const afterEnd   = e.endTime   <  now();
    const body = req.body || {};
    const data = {};

    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

    if (has('published')) {
      const raw = body.published;

      if (raw !== null && raw !== undefined) {
        if (!isManager) return res.status(403).json({ error: 'Forbidden' });

        let pv;
        if (typeof raw === 'boolean') {
          pv = raw;
        } else if (typeof raw === 'string') {
          const s = raw.trim().toLowerCase();
          if (s === 'true') pv = true;
          else if (s === 'false') pv = false;
          else return res.status(400).json({ error: 'Bad Request' });
        } else {
          return res.status(400).json({ error: 'Bad Request' });
        }

        if (!pv) return res.status(400).json({ error: 'Bad Request' });
        data.published = true;
      }
    }

    if (has('name')) {
      const raw = body.name;
      if (raw !== null && raw !== undefined) {
        if (afterStart) return res.status(400).json({ error: 'Bad Request' });
        if (typeof raw !== 'string' || raw.length === 0) {
          return res.status(400).json({ error: 'Bad Request' });
        }
        data.name = raw;
      }
    }

    if (has('description')) {
      const raw = body.description;
      if (raw !== null && raw !== undefined) {
        if (afterStart) return res.status(400).json({ error: 'Bad Request' });
        if (typeof raw !== 'string') return res.status(400).json({ error: 'Bad Request' });
        data.description = raw;
      }
    }

    if (has('location')) {
      const raw = body.location;
      if (raw !== null && raw !== undefined) {
        if (afterStart) return res.status(400).json({ error: 'Bad Request' });
        if (typeof raw !== 'string' || raw.length === 0) {
          return res.status(400).json({ error: 'Bad Request' });
        }
        data.location = raw;
      }
    }

    if (has('startTime')) {
      const raw = body.startTime;
      if (raw !== null && raw !== undefined) {
        if (afterStart) return res.status(400).json({ error: 'Bad Request' });
        const st = new Date(raw);
        if (!Number.isFinite(st.getTime()) || !(st > now())) {
          return res.status(400).json({ error: 'Bad Request' });
        }
        data.startTime = st;
      }
    }

    if (has('endTime')) {
      const raw = body.endTime;
      if (raw !== null && raw !== undefined) {
        if (afterEnd) return res.status(400).json({ error: 'Bad Request' });
        const et = new Date(raw);
        const stBase = data.startTime || e.startTime;
        if (!Number.isFinite(et.getTime()) || !(et > stBase)) {
          return res.status(400).json({ error: 'Bad Request' });
        }
        data.endTime = et;
      }
    }

    if (has('capacity')) {
      const raw = body.capacity;

      if (raw !== null && raw !== undefined) {
        if (afterStart) return res.status(400).json({ error: 'Bad Request' });

        const newCap = Number(raw);
        if (!Number.isFinite(newCap) || newCap <= 0) {
          return res.status(400).json({ error: 'Bad Request' });
        }

        const numGuests = await prisma.eventGuest.count({ where: { eventId: id } });
        if (newCap < numGuests) return res.status(400).json({ error: 'Bad Request' });

        data.capacity = newCap;
      }
    }

    if (has('points')) {
      const raw = body.points;

      if (raw !== null && raw !== undefined) {
        if (!isManager) return res.status(403).json({ error: 'Forbidden' });
        if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
          return res.status(400).json({ error: 'Bad Request' });
        }

        const newTotal = raw;
        const delta = newTotal - e.pointsTotal;
        if (e.pointsRemain + delta < 0) {
          return res.status(400).json({ error: 'Bad Request' });
        }
        data.pointsTotal  = newTotal;
        data.pointsRemain = e.pointsRemain + delta;
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const updated = await prisma.event.update({ where: { id }, data });
    return res.json(updated);
  } catch {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Events: delete if unpublished
app.delete('/events/:id', auth, needRole('manager'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(404).json({ error: 'Not Found' });
    }

    const e = await prisma.event.findUnique({ where: { id } });
    if (!e) return res.status(404).json({ error: 'Not Found' });

    if (e.published === true) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    await prisma.$transaction(async (px) => {
      await px.eventGuest.deleteMany({ where: { eventId: id } });
      await px.eventOrganizer.deleteMany({ where: { eventId: id } });
      await px.transaction.deleteMany({
        where: { type: 'event', relatedId: id },
      });
      await px.event.delete({ where: { id } });
    });

    return res.status(204).end();
  } catch (e) {

    if (e && e.code === 'P2025') {
      return res.status(404).json({ error: 'Not Found' });
    }
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Event organizers: add (manager)
app.post('/events/:id/organizers', auth, needRole('manager'), async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    const { utorid } = req.body || {};
    if (!utorid) return res.status(400).json({ error: 'Bad Request' });

    const e = await prisma.event.findUnique({ where: { id: eventId } });
    if (!e) return res.status(404).json({ error: 'Not Found' });
    if (e.endTime < now()) return res.status(410).json({ error: 'Gone' });

    const u = await prisma.user.findUnique({ where: { utorid } });
    if (!u) return res.status(404).json({ error: 'Not Found' });

    const guest = await prisma.eventGuest.findUnique({
      where: { eventId_userId: { eventId, userId: u.id } }
    }).catch(() => null);
    if (guest) return res.status(400).json({ error: 'Bad Request' });

    await prisma.eventOrganizer.upsert({
      where: { eventId_userId: { eventId, userId: u.id } },
      update: {},
      create: { eventId, userId: u.id }
    });

    const organizers = await prisma.eventOrganizer.findMany({
      where: { eventId },
      include: { user: { select: { id: true, utorid: true, name: true } } }
    });

    return res.status(201).json({
      id: e.id,
      name: e.name,
      location: e.location,
      organizers: organizers.map(o => ({
        id: o.user.id, utorid: o.user.utorid, name: o.user.name
      }))
    });
  } catch {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Event organizers: remove (manager)
app.delete('/events/:id/organizers/:userId', auth, needRole('manager'), async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    const userId = Number(req.params.userId);
    const exists = await prisma.eventOrganizer.findUnique({ where: { eventId_userId: { eventId, userId } } }).catch(() => null);
    if (!exists) return res.status(404).json({ error: 'Not Found' });
    await prisma.eventOrganizer.delete({ where: { eventId_userId: { eventId, userId } } });
    res.status(204).end();
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// Event guests: add (manager or organizer)
app.post('/events/:id/guests', auth, async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    const { utorid } = req.body || {};
    if (!utorid) return res.status(400).json({ error: 'Bad Request' });

    const e = await prisma.event.findUnique({ where: { id: eventId } });
    if (!e) return res.status(404).json({ error: 'Not Found' });

    const isManager = ORDER[req.auth.role] >= ORDER['manager'];
    const isOrganizer = !!(await prisma.eventOrganizer.findUnique({
      where: { eventId_userId: { eventId, userId: req.auth.id } }
    }).catch(() => null));
    if (!isManager && !isOrganizer) return res.status(403).json({ error: 'Forbidden' });
    if (isOrganizer && !e.published) return res.status(404).json({ error: 'Not Found' });
    if (e.endTime < now()) return res.status(410).json({ error: 'Gone' });

    const u = await prisma.user.findUnique({ where: { utorid } });
    if (!u) return res.status(404).json({ error: 'Not Found' });

    const org = await prisma.eventOrganizer.findUnique({
      where: { eventId_userId: { eventId, userId: u.id } }
    }).catch(() => null);
    if (org) return res.status(400).json({ error: 'Bad Request' });

    if (await prisma.eventGuest.findUnique({
      where: { eventId_userId: { eventId, userId: u.id } }
    }).catch(() => null)) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    if (e.capacity != null) {
      const cnt = await prisma.eventGuest.count({ where: { eventId } });
      if (cnt >= e.capacity) return res.status(410).json({ error: 'Gone' });
    }

    await prisma.eventGuest.create({ data: { eventId, userId: u.id } });

    const numGuests = await prisma.eventGuest.count({ where: { eventId } });

    return res.status(201).json({
      id: e.id,
      name: e.name,
      location: e.location,
      guestAdded: { id: u.id, utorid: u.utorid, name: u.name },
      numGuests
    });
  } catch {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Event guests: self cancel RSVP
app.delete('/events/:id/guests/me', auth, async (req, res) => {
  try {
    const eventId = Number(req.params.id);

    const e = await prisma.event.findUnique({ where: { id: eventId } });
    if (!e) {
      return res.status(404).json({ error: 'Not Found' });
    }

    if (e.endTime < now()) {
      return res.status(410).json({ error: 'Gone' });
    }

    const guest = await prisma.eventGuest.findUnique({
      where: { eventId_userId: { eventId, userId: req.auth.id } }
    }).catch(() => null);

    if (!guest) {

      return res.status(404).json({ error: 'Not Found' });
    }

    await prisma.eventGuest.delete({
      where: { eventId_userId: { eventId, userId: req.auth.id } }
    });

    return res.status(204).end();
  } catch {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Event guests: remove by manager
app.delete('/events/:id/guests/:userId', auth, needRole('manager'), async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    const userId = Number(req.params.userId);
    const exists = await prisma.eventGuest.findUnique({ where: { eventId_userId: { eventId, userId } } }).catch(() => null);
    if (!exists) return res.status(404).json({ error: 'Not Found' });
    await prisma.eventGuest.delete({ where: { eventId_userId: { eventId, userId } } });
    res.status(204).end();
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// Event guests: self RSVP
app.post('/events/:id/guests/me', auth, async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      return res.status(404).json({ error: 'Not Found' });
    }

    const e = await prisma.event.findUnique({ where: { id: eventId } });
    if (!e) return res.status(404).json({ error: 'Not Found' });

    if (!e.published) return res.status(404).json({ error: 'Not Found' });

    if (e.endTime < now()) return res.status(410).json({ error: 'Gone' });

    const org = await prisma.eventOrganizer.findUnique({
      where: { eventId_userId: { eventId, userId: req.auth.id } }
    }).catch(() => null);
    if (org) return res.status(400).json({ error: 'Bad Request' });

    const existingGuest = await prisma.eventGuest.findUnique({
      where: { eventId_userId: { eventId, userId: req.auth.id } }
    }).catch(() => null);
    if (existingGuest) return res.status(400).json({ error: 'Bad Request' });

    if (e.capacity != null) {
      const cnt = await prisma.eventGuest.count({ where: { eventId } });
      if (cnt >= e.capacity) {
        return res.status(410).json({ error: 'Gone' });
      }
    }

    const me = await prisma.user.findUnique({
      where: { id: req.auth.id },
      select: { id: true, utorid: true, name: true }
    });

    await prisma.eventGuest.create({
      data: { eventId, userId: req.auth.id }
    });

    const numGuests = await prisma.eventGuest.count({ where: { eventId } });

    return res.status(201).json({
      id: e.id,
      name: e.name,
      location: e.location,
      guestAdded: {
        id: me.id,
        utorid: me.utorid,
        name: me.name
      },
      numGuests
    });
  } catch {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Event awards: grant points to one/all guests
app.post('/events/:id/transactions', auth, async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      return res.status(404).json({ error: 'Not Found' });
    }

    const { type, utorid, amount, remark = '' } = req.body || {};

    if (type !== 'event') {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const award = Number(amount);
    if (!Number.isInteger(award) || award <= 0) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const e = await prisma.event.findUnique({ where: { id: eventId } });
    if (!e) return res.status(404).json({ error: 'Not Found' });

    const isManager = ORDER[req.auth.role] >= ORDER['manager'];
    const isOrganizer = !!(await prisma.eventOrganizer.findUnique({
      where: { eventId_userId: { eventId, userId: req.auth.id } }
    }).catch(() => null));

    if (!isManager && !isOrganizer) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const hasUtorid = typeof utorid === 'string' && utorid.length > 0;

    if (!hasUtorid) {
      const guests = await prisma.eventGuest.findMany({
        where: { eventId },
        include: { user: { select: { id: true, utorid: true } } }
      });

      const needed = award * guests.length;

      if (e.pointsRemain < needed) {
        return res.status(400).json({ error: 'Bad Request' });
      }

      if (guests.length === 0) {

        return res.status(200).json([]);
      }

      const results = [];
      await prisma.$transaction(async (px) => {
        for (const g of guests) {
          const tx = await px.transaction.create({
            data: {
              userId: g.user.id,
              type: 'event',
              amount: award,
              remark,
              relatedId: eventId,
              createdById: req.auth.id,
              processedById: req.auth.id
            }
          });

          results.push({
            id: tx.id,
            recipient: g.user.utorid,
            awarded: award,
            type: 'event',
            relatedId: eventId,
            remark,
            createdBy: req.auth.utorid
          });

          await px.user.update({
            where: { id: g.user.id },
            data: { points: { increment: award } }
          });
        }

        await px.event.update({
          where: { id: eventId },
          data: {
            pointsRemain: { decrement: needed },
            pointsAwarded: { increment: needed }
          }
        });
      });

      return res.status(200).json(results);
    }

    const user = await prisma.user.findUnique({ where: { utorid } });
    if (!user) return res.status(404).json({ error: 'Not Found' });

    const isGuest = await prisma.eventGuest.findUnique({
      where: { eventId_userId: { eventId, userId: user.id } }
    }).catch(() => null);

    if (!isGuest) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    if (e.pointsRemain < award) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const tx = await prisma.$transaction(async (px) => {
      const created = await px.transaction.create({
        data: {
          userId: user.id,
          type: 'event',
          amount: award,
          remark,
          relatedId: eventId,
          createdById: req.auth.id,
          processedById: req.auth.id
        }
      });

      await px.user.update({
        where: { id: user.id },
        data: { points: { increment: award } }
      });

      await px.event.update({
        where: { id: eventId },
        data: {
          pointsRemain: { decrement: award },
          pointsAwarded: { increment: award }
        }
      });

      return created;
    });

    return res.status(201).json({
      id: tx.id,
      recipient: utorid,
      awarded: award,
      type: 'event',
      relatedId: eventId,
      remark,
      createdBy: req.auth.utorid
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Transactions: purchase/adjustment
app.post('/transactions', auth, async (req, res) => {
  try {
    const { type } = req.body || {};
    if (!type || !['purchase', 'adjustment'].includes(type)) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    if (type === 'purchase') {

      if (ORDER[req.auth.role] < ORDER['cashier']) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const {
        utorid,
        spent,
        remark = '',
        promotionIds = [],
        suspicious = false
      } = req.body || {};

      if (!utorid || spent == null) {
        return res.status(400).json({ error: 'Bad Request' });
      }

      const spentNum = Number(spent);
      if (!Number.isFinite(spentNum) || spentNum < 0) {
        return res.status(400).json({ error: 'Bad Request' });
      }

      if (!Array.isArray(promotionIds)) {
        return res.status(400).json({ error: 'Bad Request' });
      }

      const user = await prisma.user.findUnique({ where: { utorid } });
      if (!user) {
        return res.status(404).json({ error: 'Not Found' });
      }

      const cashier = await prisma.user.findUnique({ where: { id: req.auth.id } });
      const cashierSuspicious = cashier?.suspicious === true;
      const bodySuspicious = suspicious === true;
      const effectiveSuspicious = cashierSuspicious || bodySuspicious;

      const promos = await prisma.promotion.findMany({});
      const active = promos.filter(isActivePromo);
      const automatic = active.filter(p => p.type === 'automatic');
      const oneTimeMap = new Map(
        active
          .filter(p => p.type === 'onetime')
          .map(p => [p.id, p])
      );

      const used = await prisma.userPromotionUsage.findMany({
        where: { userId: user.id, usedAt: { not: null } },
        select: { promotionId: true }
      });
      const usedSet = new Set(used.map(x => x.promotionId));

      const chosenOneTime = [];
      for (const raw of promotionIds) {
        if (raw === null || raw === undefined || raw === '') {
          return res.status(400).json({ error: 'Bad Request' });
        }
        const pid = Number(raw);
        if (!Number.isInteger(pid) || pid <= 0) {
          return res.status(400).json({ error: 'Bad Request' });
        }
        const p = oneTimeMap.get(pid);
        if (!p || usedSet.has(pid)) {
          return res.status(400).json({ error: 'Bad Request' });
        }
        chosenOneTime.push(p);
      }

      const base = basePoints(spentNum);
      let extra = 0;

      for (const p of automatic) {
        if (p.minSpending != null && spentNum < Number(p.minSpending)) continue;
        if (p.rate != null)   extra += Math.round(spentNum * 100 * Number(p.rate));
        if (p.points != null) extra += Number(p.points);
      }
      for (const p of chosenOneTime) {
        if (p.minSpending != null && spentNum < Number(p.minSpending)) continue;
        if (p.rate != null)   extra += Math.round(spentNum * 100 * Number(p.rate));
        if (p.points != null) extra += Number(p.points);
      }

      const earned = base + extra;
      const allPromos = [...automatic, ...chosenOneTime];

      let createdTx;
      await prisma.$transaction(async (px) => {

        const tx = await px.transaction.create({
          data: {
            userId: user.id,
            type: 'purchase',
            amount: earned,
            spent: spentNum,
            remark,
            suspicious: effectiveSuspicious,
            relatedId: null,
            createdById: req.auth.id,
            processedById: req.auth.id
          }
        });

        for (const p of allPromos) {
          await px.transactionPromotion.create({
            data: { transactionId: tx.id, promotionId: p.id }
          });
        }

        for (const p of chosenOneTime) {
          if (p.type === 'onetime') {
            await px.userPromotionUsage.upsert({
              where: { userId_promotionId: { userId: user.id, promotionId: p.id } },
              update: { usedAt: now() },
              create: { userId: user.id, promotionId: p.id, usedAt: now() }
            });
          }
        }

        if (!effectiveSuspicious && earned !== 0) {
          await px.user.update({
            where: { id: user.id },
            data: { points: { increment: earned } }
          });
        }

        createdTx = tx;
      });

      return res.status(201).json({
        id: createdTx.id,
        type: createdTx.type,
        spent: spentNum,
        earned: effectiveSuspicious ? 0 : earned,
        remark,
        createdAt: createdTx.createdAt,
        createdBy: req.auth.utorid,
        utorid,
        promotionIds: allPromos.map(p => p.id)
      });
    }

    if (type === 'adjustment') {
      if (ORDER[req.auth.role] < ORDER['manager']) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const {
        utorid,
        amount,
        remark = '',
        relatedId = null,
        suspicious = false
      } = req.body || {};

      if (!utorid || typeof amount !== 'number') {
        return res.status(400).json({ error: 'Bad Request' });
      }

      const user = await prisma.user.findUnique({ where: { utorid } });
      if (!user) return res.status(404).json({ error: 'Not Found' });

      const cashier = await prisma.user.findUnique({ where: { id: req.auth.id } });
      const cashierSuspicious = cashier?.suspicious === true;
      const bodySuspicious = suspicious === true;
      const effectiveSuspicious = cashierSuspicious || bodySuspicious;

      const intAmount = Math.trunc(amount);

      const relIdNum =
        relatedId == null ? null : Number(relatedId);

      if (relIdNum != null && Number.isFinite(relIdNum)) {
        const relTx = await prisma.transaction.findUnique({
          where: { id: relIdNum }
        });
        if (!relTx || relTx.userId !== user.id) {

          return res.status(404).json({ error: 'Not Found' });
        }
      }

      const tx = await prisma.$transaction(async (px) => {
        const created = await px.transaction.create({
          data: {
            userId: user.id,
            type: 'adjustment',
            amount: intAmount,
            remark,
            relatedId: relIdNum,
            suspicious: effectiveSuspicious,
            createdById: req.auth.id
          }
        });

        await px.transaction.update({
          where: { id: created.id },
          data: { processedById: req.auth.id }
        });

        if (!effectiveSuspicious && intAmount !== 0) {
          await px.user.update({
            where: { id: user.id },
            data: { points: { increment: intAmount } }
          });
        }

        return created;
      });

      return res.status(201).json({
        id: tx.id,
        type: tx.type,
        amount: tx.amount,
        spent: null,
        remark,
        createdAt: tx.createdAt,
        createdBy: req.auth.utorid,
        utorid,
        relatedId,
        promotionIds: []

      });
    }

    return res.status(400).json({ error: 'Bad Request' });

  } catch (e) {
    console.error('POST /transactions error:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Transactions: list (manager)
app.get('/transactions', auth, needRole('manager'), async (req, res) => {
  try {
    const {
      name, createdBy, suspicious, promotionId, type, relatedId,
      amountOp, amount, page = 1, limit = 10
    } = req.query;

    const where = {};
    if (type) where.type = type;
    if (typeof relatedId !== 'undefined') where.relatedId = Number(relatedId);
    if (typeof suspicious !== 'undefined') where.suspicious = String(suspicious) === 'true';
    if (amountOp && typeof amount !== 'undefined') {
      const n = Number(amount);
      if (Number.isNaN(n)) return res.status(400).json({ error: 'Bad Request' });
      if (amountOp === 'eq') where.amount = n;
      if (amountOp === 'lt') where.amount = { lt: n };
      if (amountOp === 'lte') where.amount = { lte: n };
      if (amountOp === 'gt') where.amount = { gt: n };
      if (amountOp === 'gte') where.amount = { gte: n };
    }
    if (name) {
      where.user = {
        OR: [
          { utorid: { contains: String(name)} },
          { name: { contains: String(name)} }
        ]
      };
    }
    if (createdBy) where.createdById = Number(createdBy);

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    let txWhere = where;
    if (promotionId) {
      txWhere = {
        ...where,
        promotions: { some: { promotionId: Number(promotionId) } }
      };
    }

    const [count, rows] = await Promise.all([
      prisma.transaction.count({ where: txWhere }),
      prisma.transaction.findMany({
        where: txWhere, skip, take, orderBy: { id: 'desc' },
        select: {
          id: true, type: true, amount: true, spent: true, remark: true, suspicious: true, relatedId: true,
          createdAt: true, createdById: true, processedById: true, userId: true,
          promotions: { select: { promotionId: true } },
          user: { select: { utorid: true, name: true } }
        }
      })
    ]);

    const results = rows.map(r => ({
      id: r.id,
      user: { id: r.userId, utorid: r.user.utorid, name: r.user.name },
      type: r.type, amount: r.amount, spent: r.spent, remark: r.remark, suspicious: r.suspicious,
      relatedId: r.relatedId, createdAt: r.createdAt, createdBy: r.createdById, processedBy: r.processedById,
      promotionIds: r.promotions.map(p => p.promotionId)
    }));
    res.json({ count, results });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// Transactions: get by id (manager)
app.get('/transactions/:id', auth, needRole('manager'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const t = await prisma.transaction.findUnique({
      where: { id },
      select: {
        id: true, userId: true, type: true, amount: true, spent: true, remark: true, suspicious: true, relatedId: true,
        createdAt: true, createdById: true, processedById: true,
        promotions: { select: { promotionId: true } },
        user: { select: { utorid: true, name: true } }
      }
    });
    if (!t) return res.status(404).json({ error: 'Not Found' });
    res.json({
      id: t.id, user: { id: t.userId, utorid: t.user.utorid, name: t.user.name },
      type: t.type, amount: t.amount, spent: t.spent, remark: t.remark, suspicious: t.suspicious,
      relatedId: t.relatedId, createdAt: t.createdAt,
      createdBy: t.createdById, processedBy: t.processedById,
      promotionIds: t.promotions.map(p => p.promotionId)
    });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// Transactions: mark/unmark suspicious (manager)
app.patch('/transactions/:id/suspicious', auth, needRole('manager'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { suspicious } = req.body || {};
    if (typeof suspicious !== 'boolean') {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const t = await prisma.transaction.findUnique({ where: { id } });
    if (!t) {
      return res.status(404).json({ error: 'Not Found' });
    }

    async function formatTx(tx) {
      const [user, creator, tPromos] = await Promise.all([
        prisma.user.findUnique({ where: { id: tx.userId } }),
        tx.createdById
          ? prisma.user.findUnique({ where: { id: tx.createdById } })
          : null,
        prisma.transactionPromotion.findMany({
          where: { transactionId: tx.id },
          select: { promotionId: true }
        })
      ]);

      return {
        id: tx.id,
        utorid: user?.utorid ?? null,
        type: tx.type,
        spent: tx.spent,
        amount: tx.amount,
        promotionIds: tPromos.map(p => p.promotionId),
        suspicious: tx.suspicious,
        remark: tx.remark,
        createdBy: creator?.utorid ?? null
      };
    }

    if (t.suspicious === suspicious) {
      const body = await formatTx(t);
      return res.json(body);
    }

    await prisma.$transaction(async (px) => {
      await px.transaction.update({ where: { id }, data: { suspicious } });

      const delta = suspicious ? -t.amount : t.amount;
      await px.user.update({
        where: { id: t.userId },
        data: { points: { increment: delta } }
      });
    });

    const updated = await prisma.transaction.findUnique({ where: { id } });
    const body = await formatTx(updated);
    return res.json(body);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/users/me/transactions', auth, async (req, res) => {
  try {
    const { type, amount, remark = '' } = req.body || {};
    if (type !== 'redemption' || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const me = await prisma.user.findUnique({ where: { id: req.auth.id } });
    if (!me.verified) return res.status(403).json({ error: 'Forbidden' });

    const intAmount = Math.trunc(amount);
    if (me.points < intAmount) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const t = await prisma.transaction.create({
      data: {
        userId: me.id,
        type: 'redemption',
        amount: intAmount,
        remark,
        createdById: me.id,
        processedById: null
      }
    });

    return res.status(201).json({
      id: t.id,
      utorid: me.utorid,
      type: t.type,
      processedBy: null,
      amount: t.amount,
      remark,
      createdBy: me.utorid
    });
  } catch {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/users/me/transactions', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);
    const [count, rows] = await Promise.all([
      prisma.transaction.count({ where: { userId: req.auth.id } }),
      prisma.transaction.findMany({
        where: { userId: req.auth.id },
        orderBy: { id: 'desc' },
        skip, take,
        select: {
          id: true, type: true, amount: true, spent: true, remark: true, suspicious: true,
          relatedId: true, createdAt: true, createdById: true, processedById: true,
          promotions: { select: { promotionId: true } }
        }
      })
    ]);
    const results = rows.map(r => ({ ...r, promotionIds: r.promotions.map(p => p.promotionId) }));
    res.json({ count, results });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

app.patch('/transactions/:id/processed', auth, needRole('cashier'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const t = await prisma.transaction.findUnique({ where: { id } });
    if (!t) return res.status(404).json({ error: 'Not Found' });
    if (t.type !== 'redemption' || t.processedById) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const u = await prisma.user.findUnique({ where: { id: t.userId } });

    if (u.points < t.amount) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const updated = await prisma.$transaction(async (px) => {
      await px.user.update({
        where: { id: t.userId },
        data: { points: { decrement: t.amount } }
      });
      return await px.transaction.update({
        where: { id },
        data: { processedById: req.auth.id }
      });
    });

    const [member, creator, cashier] = await Promise.all([
      prisma.user.findUnique({ where: { id: updated.userId } }),
      updated.createdById
        ? prisma.user.findUnique({ where: { id: updated.createdById } })
        : null,
      updated.processedById
        ? prisma.user.findUnique({ where: { id: updated.processedById } })
        : null
    ]);

    return res.json({
      id: updated.id,
      utorid: member?.utorid ?? null,
      type: updated.type,
      processedBy: cashier?.utorid ?? null,
      amount: updated.amount,
      redeemed: updated.amount,
      remark: updated.remark,
      createdBy: creator?.utorid ?? null
    });
  } catch {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Transactions: create adjustment for a user (cashier+)
app.post('/users/:userId/transactions', auth, async (req, res) => {
  try {
    const recipientId = Number(req.params.userId);
    const { type, amount, remark = '' } = req.body || {};

    if (type !== 'transfer' || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'Bad Request' });
    }
    if (recipientId === req.auth.id) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const sender = await prisma.user.findUnique({ where: { id: req.auth.id } });
    const recipient = await prisma.user.findUnique({ where: { id: recipientId } });
    if (!recipient) return res.status(404).json({ error: 'Not Found' });
    if (!sender.verified) return res.status(403).json({ error: 'Forbidden' });

    const intAmount = Math.trunc(amount);
    if (sender.points < intAmount) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    let senderTx;
    await prisma.$transaction(async (px) => {

      senderTx = await px.transaction.create({
        data: {
          userId: sender.id,
          type: 'transfer',
          amount: -intAmount,
          relatedId: recipient.id,
          remark,
          createdById: sender.id,
          processedById: sender.id
        }
      });

      await px.transaction.create({
        data: {
          userId: recipient.id,
          type: 'transfer',
          amount: intAmount,
          relatedId: sender.id,
          remark,
          createdById: sender.id,
          processedById: sender.id
        }
      });

      await px.user.update({
        where: { id: sender.id },
        data: { points: { decrement: intAmount } }
      });
      await px.user.update({
        where: { id: recipient.id },
        data: { points: { increment: intAmount } }
      });
    });

    return res.status(201).json({
      id: senderTx.id,
      sender: sender.utorid,
      recipient: recipient.utorid,
      type: 'transfer',
      sent: intAmount,
      remark,
      createdBy: sender.utorid
    });
  } catch {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.use((req, res) => res.status(405).json({ error: 'Method Not Allowed' }));
app.use((err, req, res, next) => {
  if (err.name === 'UnauthorizedError') return res.status(401).json({ error: 'Unauthorized' });
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start HTTP server
const server = app.listen(port, () => console.log(`Server running on port ${port}`));
server.on('error', (err) => {
  console.error(`cannot start server: ${err.message}`);
  process.exit(1);
});
