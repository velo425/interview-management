import { createCalendarMiddleware } from './viteCalendarPlugin.js';
import { createGmailMiddleware } from './viteGmailPlugin.js';
import { createGoogleDriveMiddleware } from './viteGoogleDrivePlugin.js';
import { createJobScrapeMiddleware } from './viteJobScrapePlugin.js';
import { createUsersAdminMiddleware } from './viteUsersAdminPlugin.js';
import { getRuntimeEnv } from './runtimeEnv.js';

/**
 * Chain Connect-style API middlewares for Vite (dev) and Vercel Functions.
 * Returns true if a middleware handled the request (response already sent).
 */
export async function handleApiRequest(req, res, getEnv = getRuntimeEnv) {
  const middlewares = [
    createJobScrapeMiddleware(getEnv),
    createUsersAdminMiddleware(getEnv),
    createGoogleDriveMiddleware(getEnv),
    createGmailMiddleware(getEnv),
    createCalendarMiddleware(getEnv),
  ];

  let index = 0;
  let handled = false;

  const next = async () => {
    if (index >= middlewares.length) return;
    const current = middlewares[index];
    index += 1;
    let calledNext = false;
    const nextPromise = new Promise((resolve, reject) => {
      const runNext = async () => {
        calledNext = true;
        try {
          await next();
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      Promise.resolve(current(req, res, runNext))
        .then(() => {
          // Middleware returned without awaiting next() — still wait for the chain.
          if (!calledNext) {
            handled = true;
            resolve();
          }
        })
        .catch(reject);
    });
    await nextPromise;
  };

  await next();
  return handled;
}
