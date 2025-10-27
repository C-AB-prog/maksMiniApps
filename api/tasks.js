// api/tasks.js
import { addTask, deleteTask, getOrCreateUser, listTasks, toggleTask } from './_db.js';
import { getUserId, json } from './_utils.js';

export default async function handler(req, res) {
  try {
    const uid = getUserId(req);
    if (!uid) return json(res, 400, { ok:false, error:'no user id' });

    await getOrCreateUser(uid);

    if (req.method === 'GET') {
      const tasks = await listTasks(uid);
      return json(res, 200, { ok:true, tasks });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      if (!body?.title) return json(res, 400, { ok:false, error:'title is required' });
      const t = await addTask(uid, { title: body.title, scope: body.scope, dueDate: body.dueDate });
      return json(res, 200, { ok:true, task: t });
    }

    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (!body?.id) return json(res, 400, { ok:false, error:'id is required' });
      const t = await toggleTask(uid, { id: Number(body.id), done: !!body.done });
      if (!t) return json(res, 404, { ok:false, error:'not found' });
      return json(res, 200, { ok:true, task: t });
    }

    if (req.method === 'DELETE') {
      const id = Number(req.query.id || 0);
      if (!id) return json(res, 400, { ok:false, error:'id is required' });
      await deleteTask(uid, id);
      return json(res, 200, { ok:true });
    }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return json(res, 405, { ok:false, error:`Method ${req.method} not allowed` });
  } catch (e) {
    return json(res, 500, { ok:false, error:e.message });
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data=''; req.on('data', c => data += c);
    req.on('end', () => { try{ resolve(data?JSON.parse(data):{}); } catch(e){ reject(e); } });
    req.on('error', reject);
  });
}
