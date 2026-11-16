
import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();

const port = process.env.PORT || 5000;

// middleware
app.use(express.json());
app.use(cors());

const client = new MongoClient(
  `mongodb://${process.env.DB_USER}:${process.env.DB_PASSWORD}@ac-44gdk0u-shard-00-00.l06uzuf.mongodb.net:27017,ac-44gdk0u-shard-00-01.l06uzuf.mongodb.net:27017,ac-44gdk0u-shard-00-02.l06uzuf.mongodb.net:27017/?ssl=true&replicaSet=atlas-iuroc7-shard-0&authSource=admin`
);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectedClient = await connectToMongoDB();
const database = connectedClient.db("hireloopdb");

const users = database.collection("user");
const jobs = database.collection("jobs");
const applications = database.collection("applications");
const savedJobs = database.collection("savedJobs");
const payments = database.collection("payments");

// Prevent duplicate saved jobs for the same user
await savedJobs.createIndex(
  { userId: 1, jobId: 1 },
  { unique: true }
);

// Prevent duplicate jobId
await jobs.createIndex(
  { jobId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      jobId: { $type: "string" },
    },
  }
);

app.get("/", (req, res) => {
  res.send("hireloop is looping");
});

// ============================
// Users Related API
// ============================

app.get("/users", async (req, res) => {
  const cursor = users.find({});
  const result = await cursor.toArray();
  res.send(result);
});

app.get("/users/:id/premium", async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };

  const result = await users.findOne(query, {
    projection: { premium: 1 },
  });

  res.send(result);
});

// ============================
// Jobs Related API
// ============================

app.get("/jobs", async (req, res) => {
  const query = {};

  console.log("Received query params:", req.query);

  if (req.query.jobType) {
    query.jobType = {
      $regex: `^${req.query.jobType}$`,
      $options: "i",
    };
  }

  if (req.query.isRemote) {
    query.isRemote = req.query.isRemote === "true";
  }

  if (req.query.category) {
    query.category = req.query.category;
  }

  if (req.query.recruiterId) {
    query.recruiterId = req.query.recruiterId;
  }

  if (req.query.search) {
    query.$or = [
      { title: { $regex: req.query.search, $options: "i" } },
      { company: { $regex: req.query.search, $options: "i" } },
      { responsibilities: { $regex: req.query.search, $options: "i" } },
      { qualifications: { $regex: req.query.search, $options: "i" } },
      { requirements: { $regex: req.query.search, $options: "i" } },
    ];
  }

  console.log("MongoDB filter:", query);

  const result = await jobs.find(query).toArray();

  console.log("Jobs found:", result.length);

  res.send(result);
});

// Get single job by MongoDB _id
app.get("/jobs/:id", async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };

  const result = await jobs.findOne(query);

  res.send(result);
});

// Create new job with automatic jobId
app.post("/jobs", async (req, res) => {
  const job = req.body;

  job.jobId = `JOB-${randomUUID()}`;

  const result = await jobs.insertOne(job);

  res.status(201).send({
    ...result,
    jobId: job.jobId,
  });
});

// Update job
app.patch("/jobs/:id", async (req, res) => {
  const id = req.params.id;
  const filter = { _id: new ObjectId(id) };
  const updatedJob = req.body;

  const updateDoc = {
    $set: updatedJob,
  };

  const result = await jobs.updateOne(filter, updateDoc);

  res.send(result);
});

// Delete job
app.delete("/jobs/:id", async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };

  const result = await jobs.deleteOne(query);

  res.send(result);
});

// ============================
// Applications Related API
// ============================

app.get("/applications", async (req, res) => {
  const query = {};

  if (req.query.applicantId) {
    query.userId = req.query.applicantId;
  }

  if (req.query.jobId) {
    query.jobId = req.query.jobId;
  }

  const cursor = applications.find(query);
  const result = await cursor.toArray();

  res.send(result);
});

app.get("/applications/count", async (req, res) => {
  const query = {};

  if (req.query.applicantId) {
    query.userId = req.query.applicantId;
  }

  const result = await applications.countDocuments(query);

  res.send({ count: result });
});

app.post("/applications", async (req, res) => {
  const application = req.body;

  const result = await applications.insertOne(application);

  res.send(result);
});

// ============================
// Saved Jobs Related API
// ============================

// Save a job
app.post("/saved-jobs", async (req, res) => {
  const { userId, jobId } = req.body;

  if (!userId || !jobId) {
    return res.status(400).send({
      message: "userId and jobId are required",
    });
  }

  if (!ObjectId.isValid(jobId)) {
    return res.status(400).send({
      message: "Invalid job ID",
    });
  }

  const jobObjectId = new ObjectId(jobId);

  const job = await jobs.findOne({
    _id: jobObjectId,
  });

  if (!job) {
    return res.status(404).send({
      message: "Job not found",
    });
  }

  const existingSave = await savedJobs.findOne({
    userId,
    jobId: jobObjectId,
  });

  if (existingSave) {
    return res.status(200).send({
      message: "Job already saved",
      saved: true,
    });
  }

  const savedJob = {
    userId,
    jobId: jobObjectId,
    savedAt: new Date(),
  };

  const result = await savedJobs.insertOne(savedJob);

  res.status(201).send({
    message: "Job saved successfully",
    saved: true,
    insertedId: result.insertedId,
  });
});

// Get all saved jobs of a user
app.get("/saved-jobs", async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).send({
      message: "userId is required",
    });
  }

  const result = await savedJobs
    .aggregate([
      {
        $match: {
          userId,
        },
      },
      {
        $lookup: {
          from: "jobs",
          localField: "jobId",
          foreignField: "_id",
          as: "job",
        },
      },
      {
        $unwind: "$job",
      },
      {
        $project: {
          _id: { $toString: "$_id" },
          userId: 1,
          jobId: { $toString: "$jobId" },
          savedAt: 1,
          job: 1,
        },
      },
      {
        $sort: {
          savedAt: -1,
        },
      },
    ])
    .toArray();

  res.send(result);
});

// Unsave a job
app.delete("/saved-jobs/:jobId", async (req, res) => {
  const { jobId } = req.params;
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).send({
      message: "userId is required",
    });
  }

  if (!ObjectId.isValid(jobId)) {
    return res.status(400).send({
      message: "Invalid job ID",
    });
  }

  const result = await savedJobs.deleteOne({
    userId,
    jobId: new ObjectId(jobId),
  });

  if (result.deletedCount === 0) {
    return res.status(404).send({
      message: "Saved job not found",
    });
  }

  res.send({
    message: "Job removed from saved jobs",
    deletedCount: result.deletedCount,
  });
});

// ============================
// Payments Related API
// ============================

app.post("/payments/checkout-verify", async (req, res) => {
  try {
    const { sessionId } = req.body;

    // 1. Check session ID
    if (!sessionId) {
      return res.status(400).send({
        success: false,
        message: "Session id is required",
      });
    }

    // 2. Retrieve Stripe checkout session
    const checkoutSession =
      await stripe.checkout.sessions.retrieve(sessionId);

    const {
      id,
      status,
      payment_status,
      customer_email,
      metadata,
      payment_intent,
    } = checkoutSession;

    // 3. Verify payment status
    if (status !== "complete" || payment_status !== "paid") {
      return res.send({
        success: false,
        message: "Payment verification failed",
      });
    }

    // 4. Check existing payment
    const sessionQuery = { sessionId: id };

    const existingPayment = await payments.findOne(sessionQuery);

    if (existingPayment) {
      return res.send({
        success: true,
        message: "Payment already verified",
      });
    }

    // 5. Validate user ID
    if (!metadata?.userId || !ObjectId.isValid(metadata.userId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid user ID in Stripe metadata",
      });
    }

    // 6. Save payment information
    const paymentData = {
      sessionId: id,
      status,
      payment_status,
      customer_email,
      userId: metadata.userId,
      payment_date: new Date(),
      payment_intent,
    };

    const result = await payments.insertOne(paymentData);

    // 7. Make user premium
    const query = {
      _id: new ObjectId(metadata.userId),
    };

    const updateDoc = {
      $set: {
        premium: true,
      },
    };

    const updateResult = await users.updateOne(query, updateDoc);

    // 8. Send response
    res.send({
      success: true,
      result,
      updateResult,
    });

  } catch (error) {
    console.log("Checkout verification error:", error);

    res.status(500).send({
      success: false,
      message: error.message,
    });
  }
});

app.listen(port, () => {
  console.log(`hireloop is running on port ${port}`);
});
