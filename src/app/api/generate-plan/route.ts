import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { connectMongoDB } from "@/lib/mongodb";
import { authOptions } from "@/lib/auth";
import StudyPlan from "@/models/studyPlan";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { subject, examDate } = await req.json();
    
    // Call Express middleware for plan generation
    const response = await fetch(`${process.env.AI_MIDDLEWARE_URL}/api/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, examDate })
    });

    if (!response.ok) {
      throw new Error('Failed to generate plan');
    }

    const plan = await response.json();

    // Save to database
    await connectMongoDB();
    const newPlan = new StudyPlan({
      userId: session.user.id,
      overview: plan.overview,
      weeklyPlans: plan.weeklyPlans,
      recommendations: plan.recommendations,
      isActive: true,
      progress: 0,
      lastUpdated: new Date()
    });

    await newPlan.save();
    return NextResponse.json({ plan: newPlan });

  } catch (error) {
    console.error("Error generating plan:", error);
    return NextResponse.json(
      { error: "Failed to generate plan" },
      { status: 500 }
    );
  }
}