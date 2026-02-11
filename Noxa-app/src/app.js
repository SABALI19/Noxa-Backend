import express from 'express';


const app = express(); // Create an Express app
// gives the server the ability to to pass response in json 
app.use(express.json ());

// Routes import
import userRouter from './routes/user.route.js'; //route import


//routes declaration or specification
app.use("/api/v1/users", userRouter);

//example route: http://localhost:4000/api/v1/users/register 
  
export default app;