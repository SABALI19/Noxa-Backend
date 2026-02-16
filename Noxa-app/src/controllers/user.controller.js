import { User } from "../models/user.model.js";

const registerUser = async (req, res) => {
  try {
    const { username, password, email } = req.body;

    // basic validation
    if (!username || !password || !email) {
      return res.status(400).json({
        message: "all fields are required",
      });
    }

    // check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        message: "User already exists",
      });
    }

    // create new user
    const user = await User.create({
      username,
      email: email.toLowerCase(),
      password,
      loggedIn: false,
    });

    // this is for when a user is created successfully
    res.status(201).json({
      message: "User registered",
      user: { id: user._id, email: user.email, username: user.username },
    });
  } catch (error) {
    res.status(500).json({
      message: "internal server error",
      error: error.message,
    });
  }
};

const loginUser = async (req, res) => {
    try {

        //checking if user already exist
        const { email, password } = req.body;

        const user = await User.findOne({
            email: email.toLowerCase()
        });

        if (!user) return res.status(400).json({
            message: "User not found"
        });

        //compare passwords
        const isMatch = await user.comparePassword(password);
        if(!isMatch) return res.status(400).json({
          message: "invalid credentials"
        })

        res.status(200).json({
          message: "user logged in",
          user: {
            id: user._id,
            email: user.email,
            username: user.username
          }
        })
    } catch(error) {
      res.status(500).json({
        message: "Internal server error"
      })
    }
}
const logoutUser = async (req, res) => {
  try {
    const {email} = req.body;

    const user = await User.findOne({
      email
    });

    if (!user) return res.status(404).json({
      message: "User not found"
    });

    res.status(200).json({
      message: "logout successful"
    });


  } catch (error) {
    res.status(500).json({
      message: "Internal server error", error
    });
    
  }
}
// export this to be able to use in another file
export { 
  registerUser,
  loginUser,
  logoutUser
 };