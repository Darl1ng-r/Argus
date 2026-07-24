import express from 'express';
import cors from 'cors';
import { graphService } from './services/graphService.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// GET /api/topics - List all topics
app.get('/api/topics', (req, res) => {
  try {
    const topics = graphService.getAllTopics();
    res.json(topics);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/topics/:id - Fetch topic by ID with nodes
app.get('/api/topics/:id', (req, res) => {
  try {
    const topic = graphService.getTopic(req.params.id);
    if (!topic) {
      return res.status(404).json({ error: 'Topic not found' });
    }
    res.json(topic);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/topics - Create a new topic
app.post('/api/topics', (req, res) => {
  try {
    const { title, rootClaim } = req.body;
    if (!title || !rootClaim) {
      return res.status(400).json({ error: 'title and rootClaim are required' });
    }
    const topic = graphService.createTopic(title, rootClaim);
    res.status(201).json(topic);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/topics/:id/nodes - Add a claim node to a topic
app.post('/api/topics/:id/nodes', (req, res) => {
  try {
    const { parentId, edgeType, content } = req.body;
    if (!parentId || !edgeType || !content) {
      return res.status(400).json({ error: 'parentId, edgeType, and content are required' });
    }

    const newNode = graphService.addClaimNode(req.params.id, parentId, edgeType, content);
    res.status(201).json(newNode);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/topics/:id/nodes/:nodeId/vote - Vote on a claim node
app.post('/api/topics/:id/nodes/:nodeId/vote', (req, res) => {
  try {
    const { voteType } = req.body;
    if (voteType !== 'support' && voteType !== 'contest') {
      return res.status(400).json({ error: "voteType must be 'support' or 'contest'" });
    }

    const updatedNode = graphService.voteNode(req.params.id, req.params.nodeId, voteType);
    res.json(updatedNode);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/topics/:id/fork - Fork a topic graph
app.post('/api/topics/:id/fork', (req, res) => {
  try {
    const forkedTopic = graphService.forkTopic(req.params.id);
    res.status(201).json(forkedTopic);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`[ARGUS API] Listening on port ${PORT}`);
});
