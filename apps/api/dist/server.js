"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const graphService_js_1 = require("./services/graphService.js");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 4000;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// GET /api/topics - List all topics
app.get('/api/topics', (req, res) => {
    try {
        const topics = graphService_js_1.graphService.getAllTopics();
        res.json(topics);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// GET /api/topics/:id - Fetch topic by ID with nodes
app.get('/api/topics/:id', (req, res) => {
    try {
        const topic = graphService_js_1.graphService.getTopic(req.params.id);
        if (!topic) {
            return res.status(404).json({ error: 'Topic not found' });
        }
        res.json(topic);
    }
    catch (error) {
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
        const topic = graphService_js_1.graphService.createTopic(title, rootClaim);
        res.status(201).json(topic);
    }
    catch (error) {
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
        const newNode = graphService_js_1.graphService.addClaimNode(req.params.id, parentId, edgeType, content);
        res.status(201).json(newNode);
    }
    catch (error) {
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
        const updatedNode = graphService_js_1.graphService.voteNode(req.params.id, req.params.nodeId, voteType);
        res.json(updatedNode);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// POST /api/topics/:id/fork - Fork a topic graph
app.post('/api/topics/:id/fork', (req, res) => {
    try {
        const forkedTopic = graphService_js_1.graphService.forkTopic(req.params.id);
        res.status(201).json(forkedTopic);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.listen(PORT, () => {
    console.log(`[ARGUS API] Listening on port ${PORT}`);
});
