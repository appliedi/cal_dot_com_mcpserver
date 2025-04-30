#!/usr/bin/env node

import express from "express";
import bodyParser from "body-parser";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";

// -- Tools Definition --

const ADD_APPOINTMENT_TOOL: Tool = {
  name: "calcom_add_appointment",
  description: "Creates a new appointment in Cal.com calendar.",
  inputSchema: {
    type: "object",
    properties: {
      eventTypeId: { type: "number" },
      startTime: { type: "string" },
      endTime: { type: "string" },
      name: { type: "string" },
      email: { type: "string" },
      notes: { type: "string" }
    },
    required: ["eventTypeId", "startTime", "endTime", "name", "email"]
  }
};

const UPDATE_APPOINTMENT_TOOL: Tool = {
  name: "calcom_update_appointment",
  description: "Updates an existing appointment in Cal.com calendar.",
  inputSchema: {
    type: "object",
    properties: {
      bookingId: { type: "number" },
      startTime: { type: "string" },
      endTime: { type: "string" },
      notes: { type: "string" }
    },
    required: ["bookingId"]
  }
};

const DELETE_APPOINTMENT_TOOL: Tool = {
  name: "calcom_delete_appointment",
  description: "Deletes an appointment from Cal.com calendar.",
  inputSchema: {
    type: "object",
    properties: {
      bookingId: { type: "number" },
      reason: { type: "string" }
    },
    required: ["bookingId"]
  }
};

const LIST_APPOINTMENTS_TOOL: Tool = {
  name: "calcom_list_appointments",
  description: "Lists appointments from Cal.com calendar.",
  inputSchema: {
    type: "object",
    properties: {
      startDate: { type: "string" },
      endDate: { type: "string" }
    },
    required: ["startDate", "endDate"]
  }
};

// -- Server & API Setup --

const server = new Server(
  { name: "example-servers/calcom-calendar", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

const CALCOM_API_KEY = process.env.CALCOM_API_KEY || "";
if (!CALCOM_API_KEY) {
  console.error("Error: CALCOM_API_KEY environment variable is required");
  process.exit(1);
}

const calComApiClient = axios.create({
  baseURL: "https://api.cal.com/v1",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${CALCOM_API_KEY}`
  }
});

// -- Rate Limiting --

const RATE_LIMIT = { perSecond: 5, perDay: 1000 };
let requestCount = { second: 0, day: 0, lastSecReset: Date.now(), lastDayReset: Date.now() };

function checkRateLimit() {
  const now = Date.now();
  if (now - requestCount.lastSecReset > 1000) {
    requestCount.second = 0;
    requestCount.lastSecReset = now;
  }
  if (now - requestCount.lastDayReset > 86400000) {
    requestCount.day = 0;
    requestCount.lastDayReset = now;
  }
  if (requestCount.second >= RATE_LIMIT.perSecond || requestCount.day >= RATE_LIMIT.perDay) {
    throw new Error("Rate limit exceeded");
  }
  requestCount.second++;
  requestCount.day++;
}

// -- Type Guards --

function isAddArgs(args: any): args is any {
  return args && "eventTypeId" in args && "startTime" in args && "endTime" in args && "name" in args && "email" in args;
}

function isUpdateArgs(args: any): args is any {
  return args && "bookingId" in args;
}

function isDeleteArgs(args: any): args is any {
  return args && "bookingId" in args;
}

function isListArgs(args: any): args is any {
  return args && "startDate" in args && "endDate" in args;
}

// -- Cal.com Actions --

async function addAppointment(args: any) {
  checkRateLimit();
  const res = await calComApiClient.post("/bookings", {
    eventTypeId: args.eventTypeId,
    start: new Date(args.startTime).toISOString(),
    end: new Date(args.endTime).toISOString(),
    name: args.name,
    email: args.email,
    notes: args.notes
  });
  return `Created Booking ID: ${res.data.id}`;
}

async function updateAppointment(args: any) {
  checkRateLimit();
  const patch = {
    ...(args.startTime ? { start: new Date(args.startTime).toISOString() } : {}),
    ...(args.endTime ? { end: new Date(args.endTime).toISOString() } : {}),
    ...(args.notes ? { notes: args.notes } : {})
  };
  await calComApiClient.patch(`/bookings/${args.bookingId}`, patch);
  return `Updated Booking ID: ${args.bookingId}`;
}

async function deleteAppointment(args: any) {
  checkRateLimit();
  await calComApiClient.delete(`/bookings/${args.bookingId}`, {
    data: args.reason ? { reason: args.reason } : undefined
  });
  return `Deleted Booking ID: ${args.bookingId}`;
}

async function listAppointments(args: any) {
  checkRateLimit();
  const res = await calComApiClient.get("/bookings", {
    params: {
      dateFrom: args.startDate,
      dateTo: args.endDate
    }
  });
  return res.data.length === 0 ? "No appointments found." : JSON.stringify(res.data, null, 2);
}

// -- Register Handlers --

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [ADD_APPOINTMENT_TOOL, UPDATE_APPOINTMENT_TOOL, DELETE_APPOINTMENT_TOOL, LIST_APPOINTMENTS_TOOL]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result;
    switch (name) {
      case "calcom_add_appointment":
        if (!isAddArgs(args)) throw new Error("Invalid arguments");
        result = await addAppointment(args);
        break;
      case "calcom_update_appointment":
        if (!isUpdateArgs(args)) throw new Error("Invalid arguments");
        result = await updateAppointment(args);
        break;
      case "calcom_delete_appointment":
        if (!isDeleteArgs(args)) throw new Error("Invalid arguments");
        result = await deleteAppointment(args);
        break;
      case "calcom_list_appointments":
        if (!isListArgs(args)) throw new Error("Invalid arguments");
        result = await listAppointments(args);
        break;
      default:
        return { content: [{ type: "text", text: "Unknown tool" }], isError: true };
    }
    return { content: [{ type: "text", text: result }], isError: false };
  } catch (e: any) {
    return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
  }
});

// -- Start Express HTTP Server --

const app = express();
app.use(bodyParser.json());

app.post("/list-tools", async (req, res) => {
  const tools = await server.handleListTools({ params: {} });
  res.json(tools);
});

app.post("/call-tool", async (req, res) => {
  const result = await server.handleCallTool(req.body);
  res.json(result);
});

const port = process.env.PORT || 3800;
app.listen(port, () => {
  console.log(`📅 Cal.com MCP HTTP Server running on port ${port}`);
});
