/*
 * Complete this script so that it is able to add a superuser to the database
 * Usage example: 
 *   node prisma/createsu.js clive123 clive.su@mail.utoronto.ca SuperUser123!
 */
'use strict';

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

(async () => {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 3) {
      console.error('usage: node prisma/createsu.js <utorid> <email> <password>');
      process.exit(1);
    }
    const [utorid, email, password] = args;
    if (!/^[a-z0-9]{7,8}$/i.test(utorid)) {
      console.error('error: utorid must be 7-8 alphanumeric characters.');
      process.exit(1);
    }
    if (!/^[^@]+@mail\.utoronto\.ca$/i.test(email) && !/^[^@]+@utoronto\.ca$/i.test(email)) {
      console.error('error: email must be a valid UofT email.');
      process.exit(1);
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,20}$/.test(password)) {
      console.error('error: password must be 8-20 chars, include upper, lower, number, special.');
      process.exit(1);
    }

    const prisma = new PrismaClient();
    const passwordHash = await bcrypt.hash(password, 10);

    const su = await prisma.user.upsert({
      where: { utorid },
      update: {
        email,
        passwordHash,
        role: 'superuser',
        verified: true,
        suspicious: false,
        name: utorid,
      },
      create: {
        utorid,
        name: utorid,
        email,
        passwordHash,
        role: 'superuser',
        verified: true,
        suspicious: false,
      },
      select: { id: true, utorid: true, email: true, role: true, verified: true }
    });

    console.log('Superuser ready:', su);
    await prisma.$disconnect();
  } catch (err) {
    console.error('cannot create superuser:', err.message);
    process.exit(1);
  }
})();
