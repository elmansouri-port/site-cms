import { Router } from 'express';
import { authRouter } from './auth.js';
import { pagesRouter } from './pages.js';
import { stringsRouter } from './strings.js';
import { blogRouter } from './blog.js';
import { mediaRouter } from './media.js';
import { navRouter } from './navigation.js';
import { settingsRouter } from './settings.js';
import { systemRouter } from './system.js';
import { partnersRouter } from './partners.js';
import { chromeRouter } from './chrome.js';
import { integrationsRouter } from './integrations.js';

export const adminRouter = Router();

adminRouter.use('/auth', authRouter);
adminRouter.use('/pages', pagesRouter);
adminRouter.use('/strings', stringsRouter);
adminRouter.use('/blog', blogRouter);
adminRouter.use('/media', mediaRouter);
adminRouter.use('/navigation', navRouter);
adminRouter.use('/settings', settingsRouter);
adminRouter.use('/chrome', chromeRouter);
adminRouter.use('/integrations', integrationsRouter);
adminRouter.use('/partners', partnersRouter);
adminRouter.use('/', systemRouter);
