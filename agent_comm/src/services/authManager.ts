import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

export interface AuthToken {
    id: string;
    agentId: string;
    roles: string[];
    permissions: string[];
    issuedAt: number;
    expiresAt: number;
}

export interface AgentCredentials {
    agentId: string;
    apiKey: string;
    roles: string[];
}

export class AuthManager {
    private readonly jwtSecret: string;
    private readonly tokenExpiration: number;
    private credentials: Map<string, AgentCredentials>;
    private tokenBlacklist: Set<string>;

    constructor(jwtSecret: string, tokenExpiration: number = 3600) { // 1 hour default
        this.jwtSecret = jwtSecret;
        this.tokenExpiration = tokenExpiration;
        this.credentials = new Map();
        this.tokenBlacklist = new Set();
    }

    /**
     * Registers a new agent with credentials
     */
    public registerAgent(agentId: string, roles: string[] = ['agent']): AgentCredentials {
        const apiKey = this.generateApiKey();
        const credentials: AgentCredentials = {
            agentId,
            apiKey,
            roles
        };

        this.credentials.set(agentId, credentials);
        return credentials;
    }

    /**
     * Authenticates an agent and issues a JWT token
     */
    public async authenticate(agentId: string, apiKey: string): Promise<string> {
        const credentials = this.credentials.get(agentId);
        if (!credentials || credentials.apiKey !== apiKey) {
            throw new Error('Invalid credentials');
        }

        const permissions = await this.getRolePermissions(credentials.roles);
        const token = this.issueToken(agentId, credentials.roles, permissions);
        return token;
    }

    /**
     * Validates a JWT token
     */
    public validateToken(token: string): AuthToken {
        if (this.tokenBlacklist.has(token)) {
            throw new Error('Token has been revoked');
        }

        try {
            const decoded = jwt.verify(token, this.jwtSecret) as AuthToken;
            if (Date.now() >= decoded.expiresAt) {
                throw new Error('Token has expired');
            }
            return decoded;
        } catch (error) {
            throw new Error('Invalid token');
        }
    }

    /**
     * Revokes a JWT token
     */
    public revokeToken(token: string): void {
        this.tokenBlacklist.add(token);
    }

    /**
     * Middleware for authenticating requests
     */
    public authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'No token provided' });
            return;
        }

        const token = authHeader.split(' ')[1];
        try {
            const decoded = this.validateToken(token);
            (req as any).auth = decoded;
            next();
        } catch (error) {
            res.status(401).json({ error: 'Invalid token' });
        }
    };

    /**
     * Middleware for checking permissions
     */
    public checkPermission = (requiredPermission: string) => {
        return (req: Request, res: Response, next: NextFunction): void => {
            const auth = (req as any).auth as AuthToken;
            if (!auth) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }

            if (!auth.permissions.includes(requiredPermission)) {
                res.status(403).json({ error: 'Permission denied' });
                return;
            }

            next();
        };
    };

    /**
     * Middleware for checking roles
     */
    public checkRole = (requiredRole: string) => {
        return (req: Request, res: Response, next: NextFunction): void => {
            const auth = (req as any).auth as AuthToken;
            if (!auth) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }

            if (!auth.roles.includes(requiredRole)) {
                res.status(403).json({ error: 'Role not authorized' });
                return;
            }

            next();
        };
    };

    private generateApiKey(): string {
        return uuidv4();
    }

    private issueToken(agentId: string, roles: string[], permissions: string[]): string {
        const now = Date.now();
        const token: AuthToken = {
            id: uuidv4(),
            agentId,
            roles,
            permissions,
            issuedAt: now,
            expiresAt: now + (this.tokenExpiration * 1000)
        };

        return jwt.sign(token, this.jwtSecret);
    }

    private async getRolePermissions(roles: string[]): Promise<string[]> {
        // In a real implementation, this would fetch permissions from a database
        // For now, we'll use a simple mapping
        const rolePermissions: Record<string, string[]> = {
            admin: ['*'],
            orchestrator: [
                'workflow:create',
                'workflow:execute',
                'workflow:cancel',
                'workflow:view',
                'agent:manage'
            ],
            agent: [
                'workflow:execute',
                'workflow:view'
            ]
        };

        const permissions = new Set<string>();
        roles.forEach(role => {
            const rolePerms = rolePermissions[role] || [];
            rolePerms.forEach(perm => permissions.add(perm));
        });

        return Array.from(permissions);
    }
}