const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const User = require("./models/User");
const Post = require("./models/Post");
const Contact = require("./models/Contact"); 
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const nodemailer = require("nodemailer");
const uploadMiddleware = require("./middleware/multer");
const fs = require("fs");
require("dotenv").config();

const app = express();
const salt = bcrypt.genSaltSync(10);
const defaultkey = "asdfe45we45w345wegw345werjktjwertkj";
const secret = process.env.SECRET || defaultkey;

app.use(cors({ credentials: true, origin: "https://thewondererspen.netlify.app" }));
app.use(express.json());
app.use(cookieParser());
app.use("/uploads", express.static(__dirname + "/uploads"));

mongoose.set('strictQuery', false);
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.log(err));

  app.post("/register", async (req, res) => {
    const { username, password } = req.body;
  
    try {
      // Hash the password
      const hashedPassword = bcrypt.hashSync(password, salt);
  
      // Create user with isVerified: false
      const userDoc = await User.create({
        username,
        password: hashedPassword,
        isVerified: false,  // Add isVerified flag
      });
  
      // Generate a JWT token for email verification
      const token = jwt.sign({ id: userDoc._id }, secret, { expiresIn: "1h" });
  
      // Set up Nodemailer transporter
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USER,    // your Gmail
          pass: process.env.EMAIL_PASS,    // Gmail app password
        },
      });
  
      // Verification email link
      const verificationLink = `https://thewondererspen.netlify.app/verify?token=${token}`;

  
      // Send the email
      await transporter.sendMail({
        from: `"No-Reply" <${process.env.EMAIL_USER}>`,
        to: username,   // assuming username is the email address
        subject: "Verify Your Email",
        html: `<p>Click <a href="${verificationLink}">here</a> to verify your email.</p>`,
      });
  
      // Respond to the client
      res.status(201).json({ message: "Registration successful. Please verify your email." });
  
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error registering user." });
    }
  });
  

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  console.log(req.body);
  const userDoc = await User.findOne({ username });
  if (!userDoc) {
    return res.status(400).json("wrong credentials");
  }
  const passOk = bcrypt.compareSync(password, userDoc.password);
  if (passOk) {
    jwt.sign(
      { username, id: userDoc._id },
      secret,
      { expiresIn: "1h" },
      (err, token) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: "Error signing JWT token" });
        }
        res.cookie("token", token, {
          httpOnly: true,
          secure: true,
          sameSite: "None"
        }).json({
          id: userDoc._id,
          username,
        });
      }
    );
  } else {
    res.status(400).json("wrong credentials");
  }
});


app.get("/profile", (req, res) => {
  const { token } = req.cookies;
    // Check if token is missing
    if (!token) {
      return res.status(401).json({ error: "JWT must be provided" });
    }
  
  jwt.verify(token, secret, {}, (err, info) => {
    if (err) {
      console.error(err);
      return res.status(401).json({ error: "Invalid token" });
    }
    res.json(info);
  });
});

app.post("/logout", (req, res) => {
  res.cookie("token", "").json("ok");
});

app.post("/post", uploadMiddleware.single("file"), async (req, res) => {
  const { token } = req.cookies;

  jwt.verify(token, secret, {}, async (err, info) => {
    if (err) throw err;

    const { title, summary, content } = req.body;

    // Check if the file is uploaded and accessible
    const cover = req.file ? req.file.path : ""; // req.file.path will contain the Cloudinary URL

    const postDoc = await Post.create({
      title,
      summary,
      content,
      cover, // This will store the Cloudinary image URL in the 'cover' field
      author: info.id,
    });

    res.json(postDoc);
  });
});



app.put("/post", uploadMiddleware.single("file"), async (req, res) => {
  let newPath = null;
  if (req.file) {
    const { originalname, path } = req.file;
    const parts = originalname.split(".");
    const ext = parts[parts.length - 1];
    newPath = path + "." + ext;
    fs.renameSync(path, newPath);
  }
  const { token } = req.cookies;
  jwt.verify(token, secret, {}, async (err, info) => {
    if (err) throw err;
    const { id, title, summary, content } = req.body;

    const postDoc = await Post.findById(id);
    const isAuthor = JSON.stringify(postDoc.author) === JSON.stringify(info.id);
    if (!isAuthor) {
      return res.status(400).json("you are not the author");
    }
    await postDoc.updateOne({
      title,
      summary,
      content,
      cover: newPath ? newPath : postDoc.cover,
    });
    res.json(postDoc);
  });
});

app.get("/post", async (req, res) => {
  try {
    const search = req.query.search;

    const query = search
      ? {
          $or: [
            { title: { $regex: search, $options: "i" } },
            { summary: { $regex: search, $options: "i" } },
            { content: { $regex: search, $options: "i" } },
          ],
        }
      : {};

    const posts = await Post.find(query)
      .populate("author", ["username"])
      .sort({ createdAt: -1 })
      .limit(20);

    res.json(posts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});


app.get("/post/:id", async (req, res) => {
  const { id } = req.params;
  const postDoc = await Post.findById(id).populate("author", ["username"]);
  res.json(postDoc);
});

app.post("/contact", async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: "All fields are required" });
    }
    const newContact = await Contact.create({
      name,
      email,
      message,
    });
    res.status(200).json({
      message: "Your message has been sent successfully!",
      contact: newContact,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "An error occurred while submitting the contact form." });
  }
});

// Add the email verification route here
app.get("/verify", async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ message: "Token is required." });
  }

  try {
    const decoded = jwt.verify(token, secret);
    const userId = decoded.id;

    const userDoc = await User.findById(userId);

    if (!userDoc) {
      return res.status(404).json({ message: "User not found." });
    }

    userDoc.isVerified = true;
    await userDoc.save();

    res.status(200).json({ message: "Email verified successfully!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error verifying email." });
  }
});


const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client("711705450735-eo1aa8fjnjts6cbgmhqn61hmgqkmajcd.apps.googleusercontent.com");

app.post("/google-login", async (req, res) => {
  const { token } = req.body;

  try {
    // Verify the Google token using the OAuth2Client
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: "711705450735-eo1aa8fjnjts6cbgmhqn61hmgqkmajcd.apps.googleusercontent.com", // Make sure this matches the client ID you are using
    });

    const payload = ticket.getPayload();
    const userId = payload.sub; // The unique Google ID for the user

    // Check if the user already exists in the database
    let user = await User.findOne({ googleId: userId });

    if (!user) {
      // If not, create a new user
      user = new User({
        googleId: userId,
        username: payload.email, // You could customize this depending on your app's requirements
        isVerified: true, // Set to true or implement your own verification logic
      });
      await user.save();
    }

    // Generate a JWT for the user
    const tokenForUser = jwt.sign(
      { username: user.username, id: user._id },
      secret,
      { expiresIn: "1h" }
    );

    // Send the token as a response to the frontend
    res.cookie("token", tokenForUser, {
      httpOnly: true,
      secure: true,
      sameSite: "None",
    }).json({
      id: user._id,
      username: user.username,
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: "Google login failed. Please try again." });
  }
});



const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
