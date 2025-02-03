import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// Cache setup with shorter duration for fresh results
const CACHE_DURATION = 1000 * 60 * 30; // 30 minutes
const searchCache = new Map();

app.use(cors({}))
app.use(express.json());

// Enhanced Tavily search function with advanced filtering
async function searchTavily(subject, isStudyPlan = false) {
  try {
    const cacheKey = `${subject}-${isStudyPlan}`.toLowerCase().trim();
    const cachedResult = searchCache.get(cacheKey);
    if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_DURATION) {
      return cachedResult.data;
    }

    // Perform multiple targeted searches
    const searchPromises = [
      // Search for video courses
      fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TAVILY_API_KEY}`
        },
        body: JSON.stringify({
          query: `best ${subject} video courses tutorials`,
          search_depth: "advanced",
          include_answer: false,
          max_results: 5,
          include_domains: [
            "youtube.com",
            "coursera.org",
            "udemy.com"
          ]
        })
      }),
      // Search for interactive platforms
      fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TAVILY_API_KEY}`
        },
        body: JSON.stringify({
          query: `${subject} interactive learning platform tutorial`,
          search_depth: "advanced",
          include_answer: false,
          max_results: 5,
          include_domains: [
            "freecodecamp.org",
            "khanacademy.org",
            "w3schools.com",
            "codecademy.com"
          ]
        })
      })
    ];

    const [videoResults, platformResults] = await Promise.all(searchPromises.map(p => p.then(res => res.json())));
    
    // Combine and filter results
    const combinedResults = [
      ...videoResults.results,
      ...platformResults.results
    ].filter(result => {
      // Filter out low-quality or irrelevant results
      const hasRelevantTitle = result.title.toLowerCase().includes(subject.toLowerCase());
      const hasSubstantialContent = result.content.length > 100;
      const isNotAdvertisement = !result.title.toLowerCase().includes('sponsored');
      return hasRelevantTitle && hasSubstantialContent && isNotAdvertisement;
    });

    // Sort by relevance and recency
    const sortedResults = combinedResults.sort((a, b) => {
      const scoreA = (a.relevance_score || 0) + (a.timestamp ? new Date(a.timestamp).getTime() : 0);
      const scoreB = (b.relevance_score || 0) + (b.timestamp ? new Date(b.timestamp).getTime() : 0);
      return scoreB - scoreA;
    });

    // Take top 5 unique results
    const uniqueResults = Array.from(new Map(
      sortedResults.map(item => [item.url, item])
    ).values()).slice(0, 5);

    const searchData = {
      results: uniqueResults,
      answer: isStudyPlan ? await generateStudyGuide(subject) : ''
    };

    searchCache.set(cacheKey, {
      timestamp: Date.now(),
      data: searchData
    });

    return searchData;
  } catch (error) {
    console.error("Tavily search error:", error);
    return { results: [], answer: '' };
  }
}

async function generateStudyGuide(subject) {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
  const prompt = `Create a comprehensive study guide outline for ${subject}. Focus on core concepts and learning progression.`;
  const result = await model.generateContent(prompt);
  return result.response.text();
}

// Optimized study plan generation
async function generateStudyPlan(subject, examDate) {
  try {
    const cacheKey = `plan-${subject}-${examDate}`.toLowerCase();
    const cachedPlan = searchCache.get(cacheKey);
    if (cachedPlan && Date.now() - cachedPlan.timestamp < CACHE_DURATION) {
      return cachedPlan.data;
    }

    // Parallel fetch study resources and curriculum
    const [curriculumSearch, resourceSearch] = await Promise.all([
      fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TAVILY_API_KEY}`
        },
        body: JSON.stringify({
          query: `${subject} curriculum syllabus study guide`,
          search_depth: "advanced",
          include_answer: true,
          max_results: 4,
          include_domains: [
            "khanacademy.org",
            "coursera.org",
            "udemy.com",
            "youtube.com"
          ]
        })
      }).then(res => res.json()),
      fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TAVILY_API_KEY}`
        },
        body: JSON.stringify({
          query: `best way to study ${subject} study schedule`,
          search_depth: "advanced",
          include_answer: true,
          max_results: 3,
          include_domains: [
            "medium.com",
            "educationcorner.com",
            "goconqr.com",
            "mindtools.com"
          ]
        })
      }).then(res => res.json())
    ]);

    const daysUntilExam = Math.ceil(
      (new Date(examDate).getTime() - new Date().getTime()) / (1000 * 3600 * 24)
    );

    // Extract key information
    const curriculumContent = curriculumSearch.results
      .map(r => r.content.substring(0, 300))
      .join('\n');
    const studyTips = resourceSearch.results
      .map(r => r.content.substring(0, 300))
      .join('\n');

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
    const prompt = `Create a ${daysUntilExam}-day study plan for ${subject}.

Curriculum Context:
${curriculumContent}

Study Tips:
${studyTips}

Return a focused JSON study plan with:
{
  "overview": {
    "subject": "${subject}",
    "duration": "${daysUntilExam} days",
    "examDate": "${examDate}",
    "mainTopics": ["Topic 1", "Topic 2"]
  },
  "weeklyPlans": [
    {
      "week": "Week X",
      "goals": ["Goal 1", "Goal 2"],
      "dailyTasks": [
        {
          "day": "Day Y",
          "tasks": ["Task 1", "Task 2"],
          "duration": "X hours"
        }
      ]
    }
  ],
  "recommendations": ["Tip 1", "Tip 2"]
}`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }]}],
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.8,
        maxOutputTokens: 2048,
      }
    });

    const plan = JSON.parse(result.response.text().replace(/```json\s*|\s*```/g, '').trim());
    
    // Cache the result
    searchCache.set(cacheKey, {
      timestamp: Date.now(),
      data: plan
    });

    return plan;
  } catch (error) {
    console.error('Error generating study plan:', error);
    throw error;
  }
}

// Optimized plan endpoint
app.post('/api/plan', async (req, res) => {
  try {
    const { subject, examDate } = req.body;
    const plan = await generateStudyPlan(subject, examDate);
    res.json(plan);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to generate plan' });
  }
});

// Enhanced curate resources endpoint
app.post('/api/curate', async (req, res) => {
  try {
    const { subject } = req.body;
    const searchData = await searchTavily(subject);

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
    const relevantContent = searchData.results.map(result => ({
      title: result.title,
      url: result.url,
      description: result.content.substring(0, 300),
      source: new URL(result.url).hostname,
      publishDate: result.timestamp || 'N/A'
    }));

    const prompt = `As an expert educator, analyze and curate the 5 most effective learning resources for ${subject}.
Consider factors like content quality, learning approach, and user engagement.

Analyze these resources:
${JSON.stringify(relevantContent)}

Return in JSON format:
{
  "resources": [
    {
      "title": "Resource name",
      "url": "Resource URL",
      "description": "Detailed description of content and learning outcomes",
      "format": "video|course|tutorial|interactive",
      "difficulty": "beginner|intermediate|advanced",
      "timeToComplete": "Estimated completion time",
    }
  ]
}`;

    const result = await model.generateContent(prompt);
    const resources = JSON.parse(result.response.text().replace(/```json\s*|\s*```/g, '').trim());
    
    res.json(resources);
  } catch (error) {
    console.error('Error:', error);
    if (error.name === 'AbortError') {
      res.status(504).json({ error: 'Request timeout' });
    } else {
      res.status(500).json({ error: 'Failed to curate resources' });
    }
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

app.use((err, req, res) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
}); 