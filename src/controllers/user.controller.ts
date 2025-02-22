import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { asyncHandler } from "../utils/AsyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse, ResponseCode } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";
import {
  generateResetToken,
  sendResetEmailWithResend,
} from "../utils/sendresetemail.js";

const prisma = new PrismaClient();

const generateAccessRefreshToken = async (userId: string) => {
  try {
    const user = await prisma.user.findUnique({
      where: { userId },
    });

    if (!user) {
      throw new ApiError(400, "User not found");
    }

    const accessToken = jwt.sign({ userId }, process.env.JWT_SECRET!, {
      expiresIn: "1d",
    });

    const refreshToken = jwt.sign({ userId }, process.env.JWT_SECRET!, {
      expiresIn: "7d",
    });

    await prisma.user.update({
      where: { userId },
      data: { refreshToken },
    });

    return { accessToken, refreshToken };
  } catch (error) {
    console.error("Error generating tokens:", error);
    throw new ApiError(500, "Error while generating tokens");
  }
};
const createUser = asyncHandler(async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    throw new ApiError(400, "Please fill all the fields");
  }

  if (password.length < 8) {
    throw new ApiError(400, "Password must be at least 8 characters long");
  }

  const userExists = await prisma.user.findUnique({
    where: { email, username },
  });

  if (userExists) {
    throw new ApiError(400, "User already exists");
  }

  const hashPassword = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      username: username.toLowerCase(),
      email,
      password: hashPassword,
      refreshToken: "",
    },
    select: {
      userId: true,
      username: true,
      email: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return res
    .status(ResponseCode.SUCCESS_OK)
    .json(
      new ApiResponse(
        ResponseCode.SUCCESS_OK,
        user,
        "User created successfully"
      )
    );
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    throw new ApiError(400, "Please fill all the fields");
  }

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new ApiError(400, "User does not exist");
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    throw new ApiError(400, "Invalid password");
  }

  const { accessToken, refreshToken } = await generateAccessRefreshToken(
    user.userId
  );

  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };

  const userWithoutPassword = {
    userId: user.userId,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        200,
        { user: userWithoutPassword, accessToken, refreshToken },
        "User logged in successfully"
      )
    );
});

const logoutUser = asyncHandler(async (req, res) => {
  if (!req.userId) {
    throw new ApiError(401, "User not authenticated.");
  }

  await prisma.user.update({
    where: { userId: req.userId },
    data: { refreshToken: "" },
  });

  res
    .status(ResponseCode.SUCCESS_OK)
    .clearCookie("accessToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    })
    .clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    })
    .json(
      new ApiResponse(
        ResponseCode.SUCCESS_OK,
        {},
        "User logged out successfully"
      )
    );
});

const getCurrentUser = asyncHandler(async (req, res) => {
  if (!req.userId) {
    throw new ApiError(401, "User not authenticated.");
  }

  const user = await prisma.user.findUnique({
    where: { userId: req.userId },
    select: {
      userId: true,
      username: true,
      email: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) {
    throw new ApiError(404, "User not found.");
  }

  return res
    .status(ResponseCode.SUCCESS_OK)
    .json(
      new ApiResponse(
        ResponseCode.SUCCESS_OK,
        user,
        "User fetched successfully"
      )
    );
});
const forgetpassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const findemail = await prisma.user.findUnique({
    where: { email },
  });
  if (!findemail) {
    throw new ApiError(400, "User not found");
  }

  const token = generateResetToken();
  const tokenExpiry = new Date(Date.now() + 3600000);

  await prisma.user.update({
    where: { email },
    data: {
      resetToken: token,
      tokenExpires: tokenExpiry,
    },
  });
  const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

  await sendResetEmailWithResend(email, resetLink);

  return res.status(ResponseCode.SUCCESS_OK).json({
    message: "Reset link sent to your email",
  });
});

const changeusername = asyncHandler(async (req, res) => {
  const { username } = req.body;

  if (!username) {
    throw new ApiError(400, "Please give username");
  }

  const checkusernamealreadyexits = await prisma.user.findUnique({
    where: { username },
  });
  if (checkusernamealreadyexits) {
    throw new ApiError(400, "Username already exists");
  }

  const user = await prisma.user.update({
    where: { userId: req.userId },
    data: { username },
    select: {
      userId: true,
      username: true,
      email: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return res.status(ResponseCode.SUCCESS_OK).json({
    message: "Username updated successfully",
    user,
  });
});

export {
  createUser,
  generateAccessRefreshToken,
  login,
  logoutUser,
  getCurrentUser,
  forgetpassword,
  changeusername,
};
