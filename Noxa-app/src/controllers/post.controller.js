import { post as PostModel } from "../models/post.model.js";
import { emitNotification } from "../utils/emitNotification.js";

const createPost = async (req, res) => {
  try {
    const { name, description, age } = req.body;

    if (!name || !description || !age) {
      return res.status(400).json({
        message: "All fields required",
      });
    }

    const newPost = await PostModel.create({ name, description, age });

    // If auth middleware exists, target current user room. Otherwise fallback broadcast.
    const emitOptions = req.user?.id ? { userId: req.user.id } : {};

    emitNotification(
      req,
      {
        eventId: `post_created_${newPost._id}`,
        notificationType: "post_created",
        itemType: "post",
        item: {
          id: String(newPost._id),
          title: newPost.name,
          status: "created",
        },
      },
      emitOptions
    );

    return res.status(201).json({
      message: "Post created successfully",
      post: newPost,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

export { createPost };
