import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { connectMongoDB } from "@/lib/mongodb";
import { authOptions } from "@/lib/auth";
import CuratedResource from "@/models/curatedResource";
import { ObjectId } from 'mongodb';

interface TransformedResource {
  _id?: string;
  title: string;
  link: string;
  type: string;
  description: string;
}

interface MongoResource {
  _id: ObjectId;
  userId: ObjectId;
  topic: string;
  resources: TransformedResource[];
  lastUpdated: Date;
  createdAt: Date;
  updatedAt: Date;
  __v?: number;
}

// Helper function to determine resource type
function determineResourceType(url: string): string {
  if (url.includes('youtube.com')) return 'video';
  if (url.includes('github.com')) return 'repository';
  if (url.includes('coursera.org') || url.includes('edx.org')) return 'course';
  if (url.includes('medium.com') || url.includes('dev.to')) return 'article';
  return 'website';
}

// Transform resource data
function transformResourceData(resources: Record<string, unknown>[]): TransformedResource[] {
  return resources.map(resource => ({
    title: String(resource.title || ''),
    link: String(resource.url || ''),
    type: determineResourceType(String(resource.url || '')),
    description: String(resource.description || '')
  }));
}

// GET endpoint to fetch stored resources
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectMongoDB();
    const userId = new ObjectId(session.user.id);

    const resources = await CuratedResource.find({ userId }).lean();
    const typedResources = resources as unknown as MongoResource[];

    if (!typedResources || typedResources.length === 0) {
      return NextResponse.json({ resources: [] });
    }

    const transformedResources = typedResources.map(resource => ({
      _id: resource._id.toString(),
      topic: resource.topic,
      resources: resource.resources.map(item => ({
        _id: item._id?.toString(),
        title: item.title,
        description: item.description,
        type: item.type,
        link: item.link
      })),
      lastUpdated: resource.lastUpdated,
      createdAt: resource.createdAt,
      updatedAt: resource.updatedAt
    }));

    return NextResponse.json({ resources: transformedResources });
  } catch (error) {
    console.error("Error fetching resources:", error);
    return NextResponse.json(
      { error: "Failed to fetch resources" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { subject } = await req.json();
    
    // Call Express middleware
    const response = await fetch(`${process.env.NEXT_PUBLIC_AI_MIDDLEWARE_URL}/api/curate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject })
    });

    if (!response.ok) {
      throw new Error('Failed to curate resources');
    }

    const { resources } = await response.json();

    // Save to database
    await connectMongoDB();
    const newResources = new CuratedResource({
      userId: session.user.id,
      topic: subject,
      resources: transformResourceData(resources),
      lastUpdated: new Date()
    });

    await newResources.save();
    return NextResponse.json({ resources: transformResourceData(resources) });

  } catch (error) {
    console.error("Error processing request:", error);
    return NextResponse.json(
      { error: "Failed to curate resources" },
      { status: 500 }
    );
  }
}