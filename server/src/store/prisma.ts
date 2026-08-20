import { PrismaClient } from '@prisma/client';
import '../config';

export const prisma = new PrismaClient();
