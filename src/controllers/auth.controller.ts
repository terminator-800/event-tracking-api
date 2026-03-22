import { Request, Response } from "express";
import { validateRequiredFields } from '../utils/validate'
import { verifyUserCredentials, generateAuthToken, setAuthCookie } from './services/auth.service'


export class AuthController {
    
   async login(req: Request, res: Response): Promise<void> {
    const { username, password } = req.body;

    if (!validateRequiredFields({ username, password }, res)) return;

    const user = await verifyUserCredentials(username, password);
    
    if (!user) {
        res.status(401).json({ message: "Invalid username or password" });
      return;
    }

    const token = generateAuthToken(user);
    setAuthCookie(res, token);

    res.status(200).json({
      message: "Login successful",
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    });
  }

  async logout(_req: Request, res: Response): Promise<void> {
    res.clearCookie("token");
    res.status(200).json({ message: "Logged out successfully" });
  }

  async me(req: Request, res: Response): Promise<void> {
    const user = req.user;
    res.status(200).json({ user });
  }
}