/*
 * The admin API, one router per thing it manages.
 *
 * The mount order matters in one place: `systemRouter` is mounted at the root,
 * so it has to come last or its paths would shadow the named routers above it.
 */
import { Router } from 'express';
import { authRouter } from './auth.js';
import { pagesRouter } from './pages.js';
import { stringsRouter } from './strings.js';
import { blogRouter } from './blog.js';
import { mediaRouter } from './media.js';
import { navRouter } from './navigation.js';
import { settingsRouter } from './settings.js';
import { chromeRouter } from './chrome.js';
import { integrationsRouter } from './integrations.js';
import { formsRouter } from './forms.js';
import { partnersRouter } from './partners.js';
import { versionsRouter } from './versions.js';
import { dashboardRouter } from './dashboard.js';
import { usersRouter } from './users.js';
import { leadsRouter } from './leads.js';
import { redirectsRouter } from './redirects.js';
import { experimentsRouter } from './experiments.js';
import { systemRouter } from './system.js';

export const adminRouter = Router();

adminRouter.use('/auth', authRouter);

// Content
adminRouter.use('/pages', pagesRouter);
adminRouter.use('/strings', stringsRouter);
adminRouter.use('/blog', blogRouter);
adminRouter.use('/media', mediaRouter);
adminRouter.use('/navigation', navRouter);
adminRouter.use('/chrome', chromeRouter);
adminRouter.use('/partners', partnersRouter);

// Growth
adminRouter.use('/forms', formsRouter);
adminRouter.use('/experiments', experimentsRouter);
adminRouter.use('/leads', leadsRouter);
adminRouter.use('/redirects', redirectsRouter);

// Setup and operations
adminRouter.use('/settings', settingsRouter);
adminRouter.use('/integrations', integrationsRouter);
adminRouter.use('/users', usersRouter);
adminRouter.use('/versions', versionsRouter);
adminRouter.use('/dashboard', dashboardRouter);

adminRouter.use('/', systemRouter);
